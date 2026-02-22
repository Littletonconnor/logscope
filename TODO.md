# TODO - logscope Implementation Roadmap

This document maps out all the work needed to build logscope from scratch. Each phase builds on the previous one. Work through phases in order—each phase should result in a working (if incomplete) library.

---

## Phase 0: Project Setup

- [ ] Set up TypeScript configuration (`tsconfig.json` at root + package level)
- [ ] Set up tsdown build configuration for the core package
- [ ] Set up ESLint + Prettier
- [ ] Create `packages/logscope/package.json` with proper exports map
- [ ] Create `packages/logscope/src/index.ts` barrel export
- [ ] Verify `pnpm build` and `pnpm test` work (even with empty source)
- [ ] Add a basic `node:test` test file to confirm testing works

---

## Phase 1: Log Levels & Records

The foundation. Define the data structures everything else builds on.

- [ ] **`level.ts`** - Define `LogLevel` type (`trace | debug | info | warning | error | fatal`)
- [ ] **`level.ts`** - Implement `parseLogLevel()`, `isLogLevel()`, `compareLogLevel()` utilities
- [ ] **`record.ts`** - Define `LogRecord` interface (category, level, timestamp, message, properties)
- [ ] **Tests** - Unit tests for level parsing, comparison, and type guards

**Reference**: `~/oss/logtape/packages/logtape/src/level.ts`, `~/oss/logtape/packages/logtape/src/record.ts`

---

## Phase 2: Filters

Simple predicate functions that decide whether a log record should pass through.

- [ ] **`filter.ts`** - Define `Filter` type: `(record: LogRecord) => boolean`
- [ ] **`filter.ts`** - Define `FilterLike` union: `Filter | LogLevel | null`
- [ ] **`filter.ts`** - Implement `toFilter()` to normalize FilterLike into Filter
- [ ] **`filter.ts`** - Implement `getLevelFilter(level)` - hierarchical level-based filter
- [ ] **Tests** - Level filter correctly includes higher-severity levels
- [ ] **Tests** - Custom filter functions work as expected

**Reference**: `~/oss/logtape/packages/logtape/src/filter.ts`

---

## Phase 3: Sinks

Output destinations. Keep it dead simple—a sink is just a function.

- [ ] **`sink.ts`** - Define `Sink` type: `(record: LogRecord) => void`
- [ ] **`sink.ts`** - Implement `getConsoleSink(options?)` - maps levels to console methods, supports custom formatters
- [ ] **`sink.ts`** - Implement `withFilter(sink, filter)` - compose a filter onto a sink
- [ ] **Tests** - Console sink outputs to correct console methods
- [ ] **Tests** - withFilter correctly gates records

**Later (not Phase 3)**:
- Stream sink (`getStreamSink`)
- Non-blocking/buffered mode
- `fromAsyncSink` wrapper

**Reference**: `~/oss/logtape/packages/logtape/src/sink.ts`

---

## Phase 4: Formatters

How log records become human-readable text or machine-parseable JSON.

- [ ] **`formatter.ts`** - Define `TextFormatter` type: `(record: LogRecord) => string`
- [ ] **`formatter.ts`** - Implement `defaultTextFormatter` - `TIMESTAMP [LEVEL] category: message {properties}`
- [ ] **`formatter.ts`** - Implement `jsonFormatter` - JSON Lines format
- [ ] **`formatter.ts`** - Implement `ansiColorFormatter` - colored terminal output
- [ ] **`formatter.ts`** - Handle cross-runtime value inspection (Node `util.inspect`, browser `JSON.stringify`)
- [ ] **Tests** - Each formatter produces expected output format

**Reference**: `~/oss/logtape/packages/logtape/src/formatter.ts`, `~/oss/evlog/packages/evlog/src/logger.ts` (pretty printing section)

---

## Phase 5: Logger Core

The main `Logger` class and `createLogger()` factory. This is the heart of the library.

- [ ] **`logger.ts`** - Define `Logger` interface (info, debug, warn, error, fatal, trace methods)
- [ ] **`logger.ts`** - Each method supports two overloads: `(message: string, props?)` and `(props: Record<string, unknown>)`
- [ ] **`logger.ts`** - Implement internal `LoggerImpl` class
- [ ] **`logger.ts`** - Implement `createLogger(category)` factory (accepts string or string array)
- [ ] **`logger.ts`** - Implement `.child(subcategory)` for hierarchical loggers
- [ ] **`logger.ts`** - Implement `.with(properties)` for explicit context binding
- [ ] **`logger.ts`** - Use `WeakRef` for child logger references to prevent memory leaks
- [ ] **`logger.ts`** - When unconfigured, all methods are no-ops (library-first)
- [ ] **`logger.ts`** - `isEnabledFor(level)` check for conditional logging
- [ ] **Tests** - Unconfigured logger produces zero output and zero errors
- [ ] **Tests** - Logger dispatches to correct sinks based on level
- [ ] **Tests** - Child loggers inherit parent category
- [ ] **Tests** - `.with()` attaches properties to all subsequent logs

**Reference**: `~/oss/logtape/packages/logtape/src/logger.ts` (LoggerImpl class)

---

## Phase 6: Configuration System

The `configure()` function that wires loggers to sinks. Only called by app developers.

- [ ] **`config.ts`** - Define `Config` interface (sinks map, loggers array, filters map)
- [ ] **`config.ts`** - Define `LoggerConfig` interface (category, sinks, filters, level, parentSinks)
- [ ] **`config.ts`** - Implement `configure(config)` - async, sets up the logger tree
- [ ] **`config.ts`** - Implement `reset()` - clears all configuration (useful for tests)
- [ ] **`config.ts`** - Implement `dispose()` - cleanup disposable sinks
- [ ] **`config.ts`** - Implement `getConfig()` - returns current configuration
- [ ] **`config.ts`** - Wire hierarchical category dispatch: child messages bubble to parent sinks
- [ ] **`config.ts`** - Support `parentSinks: 'inherit' | 'override'` on logger configs
- [ ] **Tests** - configure() wires sinks to loggers correctly
- [ ] **Tests** - Hierarchical dispatch: child category logs reach parent sinks
- [ ] **Tests** - parentSinks: 'override' stops inheritance
- [ ] **Tests** - reset() clears all state
- [ ] **Tests** - Multiple configure() calls (reconfiguration)

**Reference**: `~/oss/logtape/packages/logtape/src/config.ts`

---

## Phase 7: Scoped Wide Events

The accumulate-then-emit pattern. This is what makes logscope unique.

- [ ] **`scope.ts`** - Define `Scope` interface (set, emit, getContext)
- [ ] **`scope.ts`** - Implement `scope(initialContext?)` method on Logger
- [ ] **`scope.ts`** - `.set(data)` deep-merges into accumulated context
- [ ] **`scope.ts`** - `.emit(overrides?)` calculates duration and emits one LogRecord with all context
- [ ] **`scope.ts`** - `.getContext()` returns current accumulated context snapshot
- [ ] **`scope.ts`** - Duration tracking (startTime on creation, duration on emit)
- [ ] **`scope.ts`** - Level determination: error if `.error()` was called, warn if `.warn()`, else info
- [ ] **`scope.ts`** - Scope inherits logger's category and context
- [ ] **Tests** - set() accumulates context correctly
- [ ] **Tests** - emit() produces one LogRecord with all accumulated data
- [ ] **Tests** - Duration is calculated from scope creation to emit
- [ ] **Tests** - Scope respects logger configuration (unconfigured = silent)
- [ ] **Tests** - Multiple set() calls deep-merge without overwriting

**Reference**: `~/oss/evlog/packages/evlog/src/logger.ts` (createRequestLogger section)

---

## Phase 8: Context System

Explicit and implicit context propagation.

- [ ] **`context.ts`** - Implement `.with(properties)` explicit context (already in Phase 5, refine here)
- [ ] **`context.ts`** - Implement `withContext(ctx, callback)` for implicit context via AsyncLocalStorage
- [ ] **`context.ts`** - Define `ContextLocalStorage` interface (abstract over AsyncLocalStorage)
- [ ] **`context.ts`** - Context priority: message props > explicit (.with) > implicit (withContext)
- [ ] **`config.ts`** - Add `contextLocalStorage` option to configure()
- [ ] **Tests** - withContext injects properties into all logs within callback
- [ ] **Tests** - Context priority order is respected
- [ ] **Tests** - Works without AsyncLocalStorage (browser environments gracefully degrade)

**Reference**: `~/oss/logtape/packages/logtape/src/context.ts`

---

## Phase 9: Cross-Runtime Utilities

Make logscope work everywhere.

- [ ] **`util.ts`** - Base implementation (browser-safe, uses JSON.stringify)
- [ ] **`util.node.ts`** - Node.js implementation (uses `util.inspect`)
- [ ] **`util.deno.ts`** - Deno implementation (uses `Deno.inspect`)
- [ ] **`package.json`** - Set up conditional imports (`#util` with node/deno/browser/default conditions)
- [ ] **`tsdown.config.ts`** - Configure multiple entry points for conditional exports
- [ ] **Tests** - Verify value inspection works in Node.js environment

**Reference**: `~/oss/logtape/packages/logtape/src/util.ts`, `util.node.ts`, `util.deno.ts`

---

## Phase 10: Public API & Barrel Export

Wire everything together into a clean public API.

- [ ] **`index.ts`** - Export all public types and functions
- [ ] **`index.ts`** - Ensure tree-shaking works (only import what you use)
- [ ] **`package.json`** - Finalize exports map (main, types, ESM, CJS)
- [ ] **`package.json`** - Set `"sideEffects": false`
- [ ] **`package.json`** - Set `"files"` to only include dist + README
- [ ] Verify the library works when imported as a dependency
- [ ] Verify unconfigured behavior is completely silent
- [ ] Verify bundle size is reasonable (target: <10KB minified+gzipped)

---

## Phase 11: Documentation & Polish

- [ ] Finalize README.md with accurate API docs and examples
- [ ] Add JSDoc comments to all public APIs
- [ ] Add CHANGELOG.md
- [ ] Add LICENSE (MIT)
- [ ] Add contributing guidelines
- [ ] Verify all code examples in README actually work

---

## Future Phases (Not MVP)

These are out of scope for the initial release but designed-for in the architecture:

### Stream Sink
- [ ] `getStreamSink(stream)` - WritableStream-based sink
- [ ] Non-blocking mode with buffered writes

### Async Sink Support
- [ ] `fromAsyncSink(fn)` - wrap async functions as sinks
- [ ] Proper disposal with Symbol.asyncDispose

### Pipeline Utilities
- [ ] `createPipeline(options)` - batching, retry, buffer management
- [ ] Composable with any sink
- [ ] Exponential/linear/fixed backoff strategies

### Sampling
- [ ] Head sampling (probabilistic per-level)
- [ ] Tail sampling (force-keep based on outcome)

### Framework Integrations (separate packages)
- [ ] `@logscope/hono` - Hono middleware
- [ ] `@logscope/express` - Express middleware
- [ ] `@logscope/next` - Next.js integration

### Sink Adapters (separate packages)
- [ ] `@logscope/axiom` - Axiom drain
- [ ] `@logscope/otlp` - OpenTelemetry drain
- [ ] `@logscope/sentry` - Sentry integration

### Browser-Specific Features
- [ ] `sendBeacon` drain for page unload reliability
- [ ] `keepalive` fetch for page transitions
- [ ] Visibility change auto-flush

### Pretty Dev Output
- [ ] Tree-formatted console output (like evlog's pretty mode)
- [ ] Automatic dev/prod detection

---

## Implementation Order Summary

```
Phase 0: Setup          → Can build and test
Phase 1: Levels/Records → Data structures exist
Phase 2: Filters        → Can filter records
Phase 3: Sinks          → Can output records
Phase 4: Formatters     → Records look good
Phase 5: Logger Core    → Can create loggers and log
Phase 6: Configuration  → Can wire loggers to sinks
Phase 7: Scoped Events  → Wide event accumulation works
Phase 8: Context        → Implicit/explicit context propagation
Phase 9: Cross-Runtime  → Works everywhere
Phase 10: Public API    → Clean exports, tree-shakeable
Phase 11: Docs/Polish   → Ready for v0.1.0 publish
```

Each phase should end with passing tests and a working (partial) library.
