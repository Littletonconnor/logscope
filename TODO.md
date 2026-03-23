# logscope — Implementation Roadmap

A structured plan for building logscope from the ground up. Each phase builds on the previous one and ends with passing tests. The architecture section below captures key decisions learned from studying [logtape](~/oss/logtape) and [evlog](~/oss/evlog) so you can reference them during implementation without needing to re-read those codebases.

---

## Architecture Decisions

These decisions are informed by deep research into logtape and evlog. They define _how_ logscope should be built, not just _what_.

### AD-1: Singleton Root via `Symbol.for`

The root logger lives on `globalThis[Symbol.for("logscope.rootLogger")]`. This ensures a single logger tree even when multiple copies of logscope are loaded (e.g., different versions as transitive dependencies). This is how logtape avoids the "dual package hazard" — two copies share one tree.

```typescript
const ROOT_KEY = Symbol.for('logscope.rootLogger')
// On first access, create the root. On subsequent access, return existing.
```

### AD-2: Three-Layer Logger Architecture

Separate concerns into three classes/concepts (from logtape):

| Layer        | Responsibility                                                                     | User-facing?        |
| ------------ | ---------------------------------------------------------------------------------- | ------------------- |
| `LoggerImpl` | Tree node. Holds sinks, filters, children, parent pointer. Walks the tree.         | No                  |
| `Logger`     | Public interface. `info()`, `warn()`, `child()`, `scope()`, etc.                   | Yes                 |
| `LoggerCtx`  | Wrapper created by `.with()`. Delegates to LoggerImpl but merges extra properties. | Yes (via `.with()`) |

**Why this matters:** The Logger interface stays clean. LoggerImpl handles tree traversal, sink collection, and filter evaluation internally. LoggerCtx is a thin decorator that adds contextual properties without polluting the tree structure.

**Key behavior:** `loggerCtx.child("db")` returns a new LoggerCtx wrapping the child LoggerImpl _with the same context properties_. Context flows down to children.

### AD-3: "Silent When Unconfigured" Is Emergent

There is no `enabled` flag, no null checks, no special "disabled logger" class. The mechanism:

1. `createLogger()` always returns a valid Logger (creates tree nodes as needed)
2. All log methods construct a LogRecord and call `emit()`
3. `emit()` calls `getSinks(level)` which walks up the tree via generator
4. If no sinks exist anywhere (nobody called `configure()`), the generator yields nothing
5. The for-of loop over sinks executes zero iterations → zero output, zero errors

This is the cleanest possible design. No branching. No special cases.

### AD-4: WeakRef Children + StrongRef Configured Loggers

From logtape — solve the memory leak problem in long-running processes:

- Child loggers are stored as `WeakRef<LoggerImpl>` (if `WeakRef` is available)
- When `configure()` attaches sinks/filters to a logger, it adds that logger to a `strongRefs: Set<LoggerImpl>` to prevent GC
- When `reset()` is called, `strongRefs` is cleared → configured loggers become collectible again

**Why both:** Without WeakRef, dynamically-created loggers (e.g., per-request `log.child(requestId)`) accumulate forever. Without strongRefs, configured loggers could be garbage-collected, losing their sinks.

### AD-5: Generator-Based Sink Collection

`*getSinks(level)` is a generator that walks up the tree yielding sinks:

```typescript
*getSinks(level: LogLevel): Iterable<Sink> {
  // Early exit: if this node's lowestLevel is above the record's level, no sinks apply
  if (this.lowestLevel !== null && compareLogLevel(level, this.lowestLevel) < 0) return
  // Walk up: parent sinks first (unless overridden)
  if (this.parent && this.parentSinks === 'inherit') {
    yield* this.parent.getSinks(level)
  }
  // Then this node's own sinks
  yield* this.sinks
}
```

Parent sinks come first, then the node's own sinks. `parentSinks: "override"` stops the upward walk.

### AD-6: Sink Error Handling via Meta Logger + Bypass Set

When a sink throws during `emit()`:

1. Catch the error
2. Log it to the meta logger at category `["logscope", "meta"]`
3. Add the failing sink to a `bypassSinks: Set<Sink>` passed to the meta logger's emit
4. The meta logger skips any sink in `bypassSinks`, preventing infinite recursion

If the meta logger isn't explicitly configured, `configure()` adds a default console sink to it automatically.

### AD-7: Filter Inheritance Differs from Sink Inheritance

Sinks bubble up (child → parent). Filters do NOT cascade the same way:

- If a logger node has its _own_ filters, only those are checked
- If a logger node has _no_ filters, it delegates to its parent
- This means: a configured filter on a child completely replaces parent filtering for that branch

This is intentional — you want to say "the db logger should only show warnings" without also applying the parent's debug filter.

### AD-8: Type-Safe Config with Generics

From logtape — `Config<TSinkId, TFilterId>` makes sink/filter references type-safe:

```typescript
configure({
  sinks: { console: getConsoleSink(), file: getFileSink() },
  filters: { noTrace: 'info' },
  loggers: [
    { category: 'app', sinks: ['console'], filters: ['noTrace'] },
    //                          ^^^^^^^^^^            ^^^^^^^^^^^
    //                          TypeScript knows these must be 'console' | 'file'
  ],
})
```

### AD-9: Scope Context Accumulation (from evlog)

Wide event scopes use deep-merge where **new data wins over existing**:

```typescript
scope.set({ user: { id: '123' } })
scope.set({ user: { plan: 'premium' } })
// Result: { user: { id: '123', plan: 'premium' } }

scope.set({ user: { id: '456' } })
// Result: { user: { id: '456', plan: 'premium' } }  ← new id wins
```

evlog uses `deepDefaults(newData, existingContext)` where the first argument is the "base" (winner). We should implement a `deepMerge` utility with clear semantics.

### AD-10: Level Naming — "warning" Internally, "warn" as Alias

The level is `"warning"` (not `"warn"`) to match logtape and avoid ambiguity. The Logger interface provides both `.warn()` and `.warning()` as aliases for ergonomics (`.warn()` matches `console.warn`).

### AD-11: Message Format — Array of Interleaved Parts

From logtape — the `message` field on LogRecord is `readonly unknown[]`, not a string:

```typescript
// logger.info`Hello ${name}, you have ${count} items`
// message: ["Hello ", "Alice", ", you have ", 42, " items"]
//           ^string   ^value   ^string        ^value ^string
```

Always odd length. Strings at even indices, values at odd indices. This preserves structured values for formatters — console formatter uses `%o`, text formatter uses `inspect()`, JSON formatter uses `JSON.stringify()`.

### AD-12: Cross-Runtime Value Inspection via Conditional Imports

Use package.json `imports` field with the `#util` alias:

```json
{
  "#util": {
    "node": "./dist/util.node.js",
    "bun": "./dist/util.node.js",
    "deno": "./dist/util.deno.js",
    "browser": "./dist/util.browser.js",
    "default": "./dist/util.browser.js"
  }
}
```

Each file exports an `inspect(value): string` function. Node uses `util.inspect`, Deno uses `Deno.inspect`, browser/default uses `JSON.stringify`. Formatters import from `#util` and get the right implementation at build time.

---

## Phase 0: Project Setup ✅

- [x] TypeScript configuration (root + package level)
- [x] tsdown build configuration (ESM + CJS, platform neutral)
- [x] ESLint + Prettier
- [x] `packages/logscope/package.json` with exports map
- [x] `packages/logscope/src/index.ts` barrel export
- [x] `pnpm build` and `pnpm test` verified working
- [x] Basic `node:test` test confirming infrastructure works

---

## Phase 1: Log Levels & Records ✅

The foundation types that everything else builds on. Small, self-contained, easy to get right first.

### `level.ts`

- [x] Define `logLevels` const array: `["trace", "debug", "info", "warning", "error", "fatal"] as const`
- [x] Define `LogLevel` type from the array: `typeof logLevels[number]`
- [x] `compareLogLevel(a, b)` — returns negative/zero/positive (uses `indexOf`)
- [x] `parseLogLevel(str)` — case-insensitive string → LogLevel (throws on invalid)
- [x] `isLogLevel(str)` — type guard (case-sensitive, returns `str is LogLevel`)
- [x] `getLogLevels()` — returns a copy of the levels array

**Design note:** Keep this module tiny (~40 lines). logtape's is 64 lines. No classes, just functions and types.

### `record.ts`

- [x] Define `LogRecord` interface:
  ```typescript
  interface LogRecord {
    readonly category: readonly string[]
    readonly level: LogLevel
    readonly timestamp: number // Date.now() milliseconds
    readonly message: readonly unknown[] // Interleaved string/value array (see AD-11)
    readonly rawMessage: string // Original message template
    readonly properties: Record<string, unknown>
  }
  ```

**Decision point:** Do we want `rawMessage` as `string | TemplateStringsArray` like logtape? Or just `string` for simplicity? Think about whether tagged template support (Phase 5) needs the TemplateStringsArray preserved.

- Answer: Just make this a string

### Tests (`level.test.ts`)

- [x] `compareLogLevel` returns correct ordering for all level pairs
- [x] `parseLogLevel` handles case-insensitive input ("INFO" → "info")
- [x] `parseLogLevel` throws on invalid input
- [x] `isLogLevel` returns true for valid levels, false for invalid
- [x] `getLogLevels` returns a copy (mutating doesn't affect original)

**Reference:** `~/oss/logtape/packages/logtape/src/level.ts` (~64 lines)

---

## Phase 2: Filters ✅

Simple predicate functions. This module is intentionally tiny — the power comes from composition.

### `filter.ts`

- [x] Define `Filter` type: `(record: LogRecord) => boolean`
- [x] Define `FilterLike` type: `Filter | LogLevel | null`
- [x] `toFilter(filterLike)` — normalizes FilterLike → Filter:
  - Function → return as-is
  - LogLevel string → `getLevelFilter(level)`
  - `null` → `() => false` (reject everything)
- [x] `getLevelFilter(level)` — returns a filter that accepts records at or above the given level

**Performance note:** logtape optimizes `getLevelFilter` with explicit comparisons instead of `compareLogLevel()` for hot-path performance. For now, using `compareLogLevel` is fine — optimize later if profiling shows it matters.

### Tests (`filter.test.ts`)

- [x] Level filter accepts records at the specified level and above
- [x] Level filter rejects records below the specified level
- [x] `toFilter` with a function passes it through unchanged
- [x] `toFilter` with `null` rejects everything
- [x] `toFilter` with a LogLevel string creates a level filter
- [x] `getLevelFilter("trace")` accepts everything

**Reference:** `~/oss/logtape/packages/logtape/src/filter.ts` (~64 lines)

---

## Phase 3: Sinks ✅

Output destinations. A sink is `(record: LogRecord) => void` — the simplest possible contract. Custom sinks are one-liners.

### `sink.ts`

- [x] Define `Sink` type: `(record: LogRecord) => void`
- [x] `getConsoleSink(options?)` — maps levels to console methods:
  - `trace` → `console.debug`
  - `debug` → `console.debug`
  - `info` → `console.info`
  - `warning` → `console.warn`
  - `error` → `console.error`
  - `fatal` → `console.error`
  - Accepts an optional `formatter: TextFormatter` to control output format
  - Default format: `"TIMESTAMP [LEVEL] category: message {properties}"`
- [x] `withFilter(sink, filter)` — returns a new Sink that only forwards records passing the filter

**Out of scope for Phase 3** (designed-for, built later):

- `getStreamSink` (WritableStream-based)
- `fromAsyncSink` (Promise → Sink wrapper)
- `fingersCrossed` (buffer-until-trigger pattern)
- Non-blocking/buffered mode

### Tests (`sink.test.ts`)

- [x] Console sink calls `console.info` for info-level records
- [x] Console sink calls `console.error` for error-level records
- [x] Console sink calls `console.warn` for warning-level records
- [x] Console sink with custom formatter uses the formatter's output
- [x] `withFilter` blocks records that fail the filter
- [x] `withFilter` passes records that satisfy the filter
- [x] Custom sink (just a function) receives the full LogRecord

**Reference:** `~/oss/logtape/packages/logtape/src/sink.ts`

---

## Phase 4: Cross-Runtime Utilities ✅

**Moved up from Phase 9.** Formatters need `inspect()`, and inspect varies by runtime. Build this before formatters so we have the right foundation.

### `util.ts` (browser/default)

- [x] `inspect(value: unknown): string` — uses `JSON.stringify` with a replacer that handles circular references, `undefined`, `BigInt`, `Error` objects
- [x] Handle edge cases: `undefined` → `"undefined"`, functions → `"[Function: name]"`, symbols → `"Symbol(description)"`

### `util.node.ts`

- [x] `inspect(value: unknown): string` — wraps Node.js `util.inspect(value, { depth: 4, colors: false })`
- [x] Re-export for use via `#util` conditional import

### `util.deno.ts`

- [x] `inspect(value: unknown): string` — wraps `Deno.inspect(value, { depth: 4 })`

### Build configuration

- [x] Add `#util` to `package.json` `imports` field with node/bun/deno/browser/default conditions (see AD-12)
- [x] Add `util.ts`, `util.node.ts`, `util.deno.ts` as entry points in `tsdown.config.ts`

### Tests (`util.test.ts`)

- [x] `inspect` renders primitives correctly (string, number, boolean, null, undefined)
- [x] `inspect` renders objects and arrays
- [x] `inspect` handles Error objects (shows name + message + stack)
- [x] `inspect` handles circular references without crashing

**Reference:** `~/oss/logtape/packages/logtape/src/util.ts`, `util.node.ts`, `util.deno.ts`

---

## Phase 5: Formatters ✅

Transform LogRecords into human-readable or machine-readable output. Depend on `#util` for value inspection.

### `formatter.ts`

- [x] Define `TextFormatter` type: `(record: LogRecord) => string`
- [x] `getTextFormatter(options?)` — configurable text output:
  - Default: `"2024-01-15T10:30:00.000Z [INFO] my-app · db: query executed {table: "users", ms: 42}"`
  - Options: timestamp format, level format, category separator, value renderer
- [x] `getJsonFormatter(options?)` — NDJSON output:
  - `{"@timestamp":"...","level":"INFO","message":"...","logger":"my-app.db","properties":{...}}`
  - Custom replacer for Error serialization (name, message, stack, cause)
- [x] `getAnsiColorFormatter(options?)` — colored terminal output using raw ANSI escape codes:
  - Level colors: trace=gray, debug=cyan, info=green, warning=yellow, error=red, fatal=red+bold
  - Timestamp in dim, category in bold
  - No color libraries — raw `\x1b[...m` codes
- [x] Internal `renderMessage(record)` helper — converts the interleaved message array into a string using `inspect()` for non-string values

**DX decision:** Formatters are factories (`getTextFormatter()`) not classes. Users get a function, not an instance. This matches the Sink contract and makes composition trivial.

### Tests (`formatter.test.ts`)

- [x] Text formatter produces expected format with all components
- [x] Text formatter handles records with no message (properties-only)
- [x] Text formatter handles records with no properties
- [x] JSON formatter produces valid JSON Lines (one JSON object per line)
- [x] JSON formatter serializes Error objects with name/message/stack/cause
- [x] ANSI formatter includes color escape codes
- [x] `renderMessage` correctly interleaves string parts and inspected values

**Reference:** `~/oss/logtape/packages/logtape/src/formatter.ts`, `~/oss/evlog/packages/evlog/src/logger.ts` (pretty printing)

---

## Phase 6: Logger Core ✅

The heart of the library. Implements the tree structure, sink dispatch, and public API.

### `logger.ts` — LoggerImpl (internal)

- [x] `LoggerImpl` class — the tree node:
  ```typescript
  class LoggerImpl {
    readonly parent: LoggerImpl | null
    readonly children: Record<string, LoggerImpl | WeakRef<LoggerImpl>>
    readonly category: readonly string[]
    readonly sinks: Sink[]
    readonly filters: Filter[]
    parentSinks: 'inherit' | 'override'
    lowestLevel: LogLevel | null
  }
  ```
- [x] Singleton root via `Symbol.for("logscope.rootLogger")` on `globalThis` (AD-1)
- [x] `getChild(subcategory)` — creates or retrieves child node, uses WeakRef (AD-4)
- [x] `*getSinks(level)` — generator walking up tree, yielding sinks (AD-5)
- [x] `filter(record)` — walks up tree checking filters (AD-7)
- [x] `emit(record, bypassSinks?)` — constructs full record, checks filters, dispatches to sinks with error handling (AD-6)
- [x] `resetDescendants()` — recursively clears sinks/filters from all descendants (for `reset()`)
- [x] Static `getLogger(category)` — navigates from root to create/find the LoggerImpl for a category

### `logger.ts` — Logger (public interface)

- [x] `Logger` interface with methods: `trace`, `debug`, `info`, `warn`/`warning`, `error`, `fatal`
- [x] Each method supports overloads:
  1. `(message: string, properties?: Record<string, unknown>)` — string + optional props
  2. `(properties: Record<string, unknown>)` — properties-only (structured log)
  3. Tagged template literal: `` log.info`Hello ${name}` `` (stretch goal — can defer)
- [x] `child(subcategory: string)` — returns Logger for `[...parentCategory, subcategory]`
- [x] `with(properties)` — returns LoggerCtx wrapping same LoggerImpl with extra properties (AD-2)
- [x] `scope(initialContext?)` — creates a Scope (Phase 7, but define the method signature here)
- [x] `isEnabledFor(level)` — checks if any sinks exist for this level (for conditional expensive computation)

### `logger.ts` — LoggerCtx (contextual wrapper)

- [x] Wraps a LoggerImpl with extra `properties: Record<string, unknown>`
- [x] All log methods merge ctx properties into the LogRecord's properties
- [x] `child()` on LoggerCtx returns a new LoggerCtx wrapping the child LoggerImpl with the _same_ properties
- [x] `with()` on LoggerCtx returns a new LoggerCtx with merged properties

### `logger.ts` — Public factory

- [x] `createLogger(category: string | readonly string[])` — the public entry point
  - String input → `["my-app"]`
  - Array input → `["my-app", "db"]`
  - Returns a Logger backed by the LoggerImpl at that category in the singleton tree

### Tests (`logger.test.ts`)

- [x] **Library-first**: Unconfigured logger produces zero output and zero errors
- [x] **Library-first**: Unconfigured logger methods do not throw
- [x] Logger dispatches records to sinks attached to its tree node
- [x] Child logger has correct category: `createLogger("app").child("db")` → `["app", "db"]`
- [x] Records bubble up to parent sinks (hierarchical dispatch)
- [x] `.with({ requestId })` attaches properties to all subsequent logs
- [x] `.with()` on child preserves parent context: `log.with({ a: 1 }).child("db").info(...)` has `a: 1`
- [x] `isEnabledFor` returns false when no sinks exist, true when they do
- [x] Multiple `createLogger("same")` calls return loggers backed by the same tree node
- [x] Singleton root: `Symbol.for("logscope.rootLogger")` on `globalThis` is reused

**Reference:** `~/oss/logtape/packages/logtape/src/logger.ts`

---

## Phase 7: Configuration System ✅

The `configure()` function wires the tree. Only called by app developers, never by library authors.

### `config.ts`

- [x] Define `Config<TSinkId, TFilterId>` interface (AD-8):
  ```typescript
  interface Config<TSinkId extends string = string, TFilterId extends string = string> {
    sinks: Record<TSinkId, Sink>
    filters?: Record<TFilterId, FilterLike>
    loggers: LoggerConfig<TSinkId, TFilterId>[]
    contextLocalStorage?: ContextLocalStorage<Record<string, unknown>>
    reset?: boolean // Allow reconfiguration (throws if already configured without this)
  }
  ```
- [x] Define `LoggerConfig<TSinkId, TFilterId>`:
  ```typescript
  interface LoggerConfig<TSinkId, TFilterId> {
    category: string | readonly string[]
    sinks: TSinkId[]
    filters?: TFilterId[]
    level?: LogLevel
    parentSinks?: 'inherit' | 'override'
  }
  ```
- [x] Module-level state: `currentConfig`, `strongRefs: Set<LoggerImpl>`, `disposables`
- [x] `configure(config)` — async function:
  1. Throw `ConfigError` if already configured and `config.reset !== true`
  2. Call `reset()` to clean up previous state
  3. For each logger config: get/create LoggerImpl, push sinks/filters, add to strongRefs
  4. Detect duplicate categories → throw ConfigError
  5. If meta logger `["logscope", "meta"]` wasn't explicitly configured, add default console sink
  6. Register exit handlers (Node: `process.on("exit")`, browser: `addEventListener("pagehide")`)
- [x] `reset()` — clears sinks/filters from all loggers, disposes disposable sinks, clears strongRefs
- [x] `dispose()` — alias for reset() with disposable cleanup emphasis

### Tests (`config.test.ts`)

- [x] `configure()` wires sinks to the correct logger tree nodes
- [x] Hierarchical dispatch: child logs reach parent-configured sinks
- [x] `parentSinks: "override"` stops upward sink inheritance
- [x] `reset()` clears all state — loggers become silent again
- [x] Throws ConfigError on duplicate `configure()` without `reset: true`
- [x] `configure({ reset: true })` reconfigures successfully
- [x] Type-safe: sink/filter IDs in loggers must match declared sinks/filters (compile-time check)
- [x] Meta logger gets default console sink when not explicitly configured
- [x] Sink errors are caught and logged to meta logger (not propagated to caller)

**Reference:** `~/oss/logtape/packages/logtape/src/config.ts`

---

## Phase 8: Scoped Wide Events ✅

The accumulate-then-emit pattern. This is logscope's unique value proposition — combining logtape's library-first architecture with evlog's wide event model.

### `scope.ts`

- [x] Define `Scope` interface:
  ```typescript
  interface Scope {
    set(data: Record<string, unknown>): void
    error(error: Error | string, context?: Record<string, unknown>): void
    warn(message: string, context?: Record<string, unknown>): void
    info(message: string, context?: Record<string, unknown>): void
    emit(overrides?: Record<string, unknown>): void
    getContext(): Record<string, unknown>
  }
  ```
- [x] `createScope(logger, initialContext?)` — internal factory (called by `logger.scope()`)
- [x] Internal state: `context`, `startTime`, `hasError`, `hasWarn`, `requestLogs[]`
- [x] `.set(data)` — deep-merges into accumulated context (new data wins, AD-9)
- [x] `.error(error, ctx?)` — sets `hasError = true`, extracts error properties (name, message, stack, cause), deep-merges
- [x] `.warn(message, ctx?)` — sets `hasWarn = true`, adds to `requestLogs` array
- [x] `.info(message, ctx?)` — adds to `requestLogs` array
- [x] `.emit(overrides?)`:
  1. Calculate `duration` from `startTime`
  2. Determine level: error if `hasError`, warning if `hasWarn`, else info
  3. Merge `overrides` into context
  4. Create LogRecord with all accumulated properties + duration + requestLogs
  5. Emit through the logger's normal dispatch (respects tree, sinks, filters)
- [x] `.getContext()` — returns a snapshot (clone) of current accumulated context
- [x] Scope inherits the logger's category and any `.with()` context

### `deepMerge` utility (in `util.ts` or `scope.ts`)

- [x] Implement `deepMerge(target, source)` — deep merge where source values win:
  - Primitive values: source wins
  - Arrays: source replaces (no concat — keeps semantics simple)
  - Objects: recursively merge
  - `null`/`undefined` in source: skip (don't overwrite with nothing)

### Tests (`scope.test.ts`)

- [x] `set()` accumulates context across multiple calls
- [x] `set()` deep-merges: `set({ user: { id: '1' } })` + `set({ user: { name: 'Alice' } })` → `{ user: { id: '1', name: 'Alice' } }`
- [x] `set()` new values win: `set({ x: 1 })` + `set({ x: 2 })` → `{ x: 2 }`
- [x] `emit()` produces one LogRecord with all accumulated data
- [x] `emit()` includes `duration` in properties (ms since scope creation)
- [x] `emit()` level is `error` when `.error()` was called
- [x] `emit()` level is `warning` when `.warn()` was called (no error)
- [x] `emit()` level is `info` by default
- [x] `error()` extracts Error properties (name, message, stack)
- [x] `getContext()` returns a snapshot that doesn't mutate when `set()` is called again
- [x] Scope respects logger configuration (unconfigured logger → scope.emit() is silent)
- [x] Scope inherits `.with()` context from its parent logger
- [x] `requestLogs` are included in the emitted record

**Reference:** `~/oss/evlog/packages/evlog/src/logger.ts` (createRequestLogger)

---

## Phase 9: Context System ✅

Explicit and implicit context propagation. Two mechanisms, clear priority order.

### `context.ts`

- [x] Define `ContextLocalStorage<T>` interface:

  ```typescript
  interface ContextLocalStorage<T> {
    getStore(): T | undefined
    run<R>(store: T, callback: () => R): R
  }
  ```

  (This abstracts over `AsyncLocalStorage` — any compatible implementation works)

- [x] `withContext(properties, callback)` — runs callback with implicit context:

  ```typescript
  withContext({ requestId: 'req_abc' }, () => {
    log.info('handled request') // requestId automatically attached
  })
  ```

  - Gets `contextLocalStorage` from the root logger's config
  - If not configured, logs warning to meta logger and runs callback without context
  - Contexts nest: child contexts inherit and override parent properties

- [x] `getImplicitContext()` — retrieves current implicit context from the storage (called internally by emit)

- [x] Context priority order (highest → lowest):
  1. **Message properties** — `log.info('msg', { requestId: 'override' })`
  2. **Explicit context** — `log.with({ requestId: 'explicit' })`
  3. **Implicit context** — `withContext({ requestId: 'implicit' }, ...)`

- [x] Add `contextLocalStorage` option to `configure()` (wire to root LoggerImpl)

### Tests (`context.test.ts`)

- [x] `withContext` injects properties into all logs within callback scope
- [x] Nested `withContext` calls: inner overrides outer for same keys
- [x] Context priority: message props > explicit `.with()` > implicit `withContext`
- [x] Without `contextLocalStorage` configured, `withContext` runs callback normally (no crash)
- [x] Context does not leak across `withContext` boundaries
- [x] Scope inside `withContext` inherits the implicit context

**Reference:** `~/oss/logtape/packages/logtape/src/context.ts`

---

## Phase 10: Public API & Barrel Export ✅

Wire everything into a clean, tree-shakeable public API.

### `index.ts`

- [x] Export public types: `LogLevel`, `LogRecord`, `Filter`, `FilterLike`, `Sink`, `TextFormatter`, `Logger`, `Scope`, `Config`, `LoggerConfig`, `ContextLocalStorage`
- [x] Export public functions: `createLogger`, `configure`, `reset`, `dispose`, `getConsoleSink`, `withFilter`, `getTextFormatter`, `getJsonFormatter`, `getAnsiColorFormatter`, `withContext`, `toFilter`, `getLevelFilter`, `parseLogLevel`, `isLogLevel`, `compareLogLevel`, `getLogLevels`
- [x] Do NOT export: `LoggerImpl`, `LoggerCtx`, internal utilities

### Package configuration

- [x] `"sideEffects": false` in package.json
- [x] `"files": ["dist", "README.md", "LICENSE"]` in package.json
- [x] Verify exports map is complete (ESM + CJS + types)
- [x] Verify tree-shaking: importing only `createLogger` should not pull in formatter code

### Integration tests

- [x] Full end-to-end: `configure()` → `createLogger()` → `log.info()` → sink receives record
- [x] Library consumer simulation: import logscope, use without configuring → zero output
- [ ] Verify bundle size is reasonable (target: <10KB minified+gzipped for core)
- [x] Verify dual ESM/CJS output works

---

## Phase 11: Documentation & Polish

- [ ] Finalize README.md with accurate API docs and realistic examples
- [ ] Add JSDoc comments to all public API functions and types
- [ ] Add CHANGELOG.md (v0.1.0)
- [ ] Add LICENSE (MIT)
- [ ] Verify all README code examples actually compile and run
- [ ] Add `"repository"`, `"keywords"`, `"description"` to package.json

---

## Future Phases (Post-MVP)

These are out of scope for v0.1.0 but the architecture supports them. The internal design should not need to change to add these.

### Stream & Async Sinks

- [ ] `getStreamSink(stream)` — WritableStream-based sink with TextEncoder
- [ ] `fromAsyncSink(fn)` — wraps async functions as sync sinks (chains promises internally)
- [ ] Proper `Symbol.asyncDispose` support for cleanup
- [ ] Non-blocking console sink with write buffering

### Pipeline Utilities (from evlog)

- [ ] `createPipeline(options)` — batching, retry, buffer overflow management
- [ ] Options: `batch.size`, `batch.intervalMs`, `maxBufferSize`, `maxAttempts`
- [ ] Backoff strategies: `exponential` (default), `linear`, `fixed`
- [ ] `onDropped(batch, error)` callback for monitoring
- [ ] `flush()` for graceful shutdown
- [ ] Composable with any sink

### Sampling (from evlog)

- [ ] Head sampling: probabilistic per-level percentage (0-100%)
- [ ] Tail sampling: force-keep conditions (status >= N, duration >= N ms, path matches pattern)
- [ ] Tail sampling checked first — if force-kept, skip head sampling entirely

### Tagged Template Literals

- [ ] `` log.info`Hello ${name}, you have ${count} items` ``
- [ ] Preserves structured values in message array
- [ ] `rawMessage` becomes `TemplateStringsArray`

### Lazy Evaluation

- [ ] `lazy(() => value)` in `.with()` — deferred evaluation per log call
- [ ] `() => ({ props })` as properties arg — only evaluated if level is enabled
- [ ] `log.info(l => l`msg ${expensive()}`)` — callback form

### Pretty Dev Output (from evlog)

- [ ] Tree-formatted wide event output with `|--` and `+--` prefixes
- [ ] Colored levels, dim timestamps, bold categories
- [ ] Auto dev/prod detection (pretty in dev, JSON in prod)

### Advanced Sink Patterns

- [ ] `fingersCrossed(sink, options)` — buffer until trigger level, then flush all
- [ ] Category isolation for fingersCrossed (descendant/ancestor/both)
- [ ] Context-based isolation with LRU eviction

### Framework Integrations (separate packages)

- [ ] `@logscope/hono` — Hono middleware (creates scope per request, emits on response)
- [ ] `@logscope/express` — Express middleware
- [ ] `@logscope/next` — Next.js integration with AsyncLocalStorage
- [ ] `@logscope/nitro` — Nitro/Nuxt plugin

### Sink Adapters (separate packages)

- [ ] `@logscope/axiom` — Axiom drain (use `defineDrain` pattern from evlog)
- [ ] `@logscope/otlp` — OpenTelemetry drain
- [ ] `@logscope/sentry` — Sentry integration

### Browser-Specific Features

- [ ] `sendBeacon` drain for page unload reliability
- [ ] `keepalive` fetch for page transitions
- [ ] Visibility change auto-flush
- [ ] `createBrowserDrain(config)` — composite browser transport

### Category Prefix (from logtape)

- [ ] `withCategoryPrefix(prefix, callback)` — prepend category segments within a scope
- [ ] Useful for SDKs that want to namespace their internal logging

---

## Implementation Order Summary

```
Phase 0:  Setup               ✅ Can build and test
Phase 1:  Levels & Records    → Foundation types exist
Phase 2:  Filters             → Can filter records by level or custom predicate
Phase 3:  Sinks               ✅ Can output records (console, custom functions)
Phase 4:  Cross-Runtime Utils → inspect() works on Node/Deno/browser
Phase 5:  Formatters          ✅ Records become readable text, JSON, or colored output
Phase 6:  Logger Core         ✅ createLogger(), child(), .with(), tree dispatch
Phase 7:  Configuration       ✅ configure() wires loggers to sinks
Phase 8:  Scoped Wide Events  ✅ scope(), .set(), .emit() accumulation pattern
Phase 9:  Context System      ✅ withContext(), implicit/explicit context
Phase 10: Public API          ✅ Clean exports, tree-shaking, bundle size
Phase 11: Docs & Polish       → README, JSDoc, LICENSE, v0.1.0
```

Each phase ends with passing tests and a working (partial) library. Phases 1-3 are small and fast. Phase 6 is the biggest. Phase 8 is the most novel.

---

## Quick Reference: What to Study

When implementing each phase, these are the key files to reference:

| Phase | logtape file                                  | evlog file                            | Notes                                               |
| ----- | --------------------------------------------- | ------------------------------------- | --------------------------------------------------- |
| 1     | `src/level.ts`, `src/record.ts`               | `src/types.ts`                        | logtape's record is the primary model               |
| 2     | `src/filter.ts`                               | —                                     | Tiny module, follow logtape exactly                 |
| 3     | `src/sink.ts`                                 | —                                     | Start with console only                             |
| 4     | `src/util.ts`, `util.node.ts`, `util.deno.ts` | —                                     | Conditional import pattern                          |
| 5     | `src/formatter.ts`                            | `src/logger.ts` (pretty section)      | logtape for structure, evlog for pretty inspiration |
| 6     | `src/logger.ts`                               | —                                     | The big one. Study LoggerImpl carefully             |
| 7     | `src/config.ts`                               | —                                     | Type-safe config pattern                            |
| 8     | —                                             | `src/logger.ts` (createRequestLogger) | evlog's accumulation model                          |
| 9     | `src/context.ts`                              | `src/next/storage.ts`                 | logtape for design, evlog for ALS usage             |
