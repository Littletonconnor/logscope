# logscope

Zero-dependency, universal, library-first structured logging with scoped wide events.

[![npm version](https://img.shields.io/npm/v/logscope?color=black)](https://npmjs.com/package/logscope)
[![license](https://img.shields.io/github/license/Littletonconnor/logscope?color=black)](https://github.com/Littletonconnor/logscope/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-black?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

---

**Your logs are lying to you.** Scattered `console.log` calls, unstructured strings, context spread across 20 log lines. When something breaks, you're grep-ing through noise hoping to find signal.

**logscope fixes this.** Every log is structured data. Quick logs emit immediately. Scoped logs accumulate context over a unit of work and emit once — with everything an engineer needs to understand what happened.

## Why logscope?

### The Problem

```typescript
// Scattered, unstructured, impossible to query
console.log('Request received')
console.log('User:', user.id)
console.log('Cart loaded, items:', cart.items.length)
console.log('Payment failed') // Good luck correlating this at 3am
```

Five `console.log` calls. Five separate lines in your log aggregator. No structure, no correlation, no way to search "show me all failed checkouts for premium users." When your pager goes off, you're reading logs like a detective novel — piecing together clues from scattered fragments.

### The Solution

```typescript
import { createLogger } from 'logscope'

const log = createLogger('checkout')

// Quick structured log — immediate, queryable
log.info('payment processed', { userId: '123', amount: 99.99 })

// Scoped wide event — accumulate context, emit once
const scope = log.scope({ method: 'POST', path: '/checkout' })
scope.set({ user: { id: '123', plan: 'premium' } })
scope.set({ cart: { items: 3, total: 99.99 } })
scope.set({ payment: { method: 'card', processor: 'stripe' } })
scope.emit()
// One structured event with ALL context + duration
```

One event. Every detail. Queryable, filterable, machine-readable. "Show me all checkouts where `user.plan = premium` and `duration > 2000ms`" becomes a trivial query.

### Built for Libraries

Most logging libraries force configuration on consumers. Import them and they immediately start writing to `stdout`, polluting your application's output. logscope doesn't. When unconfigured, all logging is **completely silent** — zero output, zero errors, zero side effects.

```typescript
// In your library — safe to ship, no config required
import { createLogger } from 'logscope'

const log = createLogger('my-awesome-lib')

export function doSomething() {
  log.debug('processing started', { step: 'init' })
  // If the app using your library never configures logscope,
  // this produces nothing. No noise, no errors, no side effects.
}
```

If the application _does_ configure logscope, those logs become visible and routable:

```typescript
// In the application entry point
import { configure, getConsoleSink } from 'logscope'

await configure({
  sinks: {
    console: getConsoleSink(),
  },
  loggers: [
    { category: 'my-app', level: 'debug', sinks: ['console'] },
    // See logs from that library too:
    { category: 'my-awesome-lib', level: 'info', sinks: ['console'] },
  ],
})
```

## Installation

```bash
npm install logscope
```

```bash
pnpm add logscope
```

```bash
bun add logscope
```

## Quick Start

### 1. Configure (once, at your app entry point)

```typescript
import { configure, getConsoleSink } from 'logscope'

await configure({
  sinks: {
    console: getConsoleSink(),
  },
  loggers: [{ category: 'my-app', level: 'debug', sinks: ['console'] }],
})
```

### 2. Create a Logger

```typescript
import { createLogger } from 'logscope'

const log = createLogger('my-app')
```

### 3. Log

```typescript
// Structured logs — immediate emission
log.info({ action: 'page_view', path: '/home' })
log.info('user logged in', { userId: '123', method: 'oauth' })
log.warn('slow query', { duration: 1200, table: 'users' })
log.error('payment failed', { orderId: 'abc', reason: 'card_declined' })
```

### 4. Scoped Wide Events

For operations that span multiple steps, accumulate context and emit once:

```typescript
const scope = log.scope({ method: 'POST', path: '/api/checkout' })

// Accumulate context as you go
scope.set({ user: { id: '123', plan: 'premium' } })
scope.set({ cart: { items: 3, total: 99.99 } })

try {
  const payment = await processPayment(cart, user)
  scope.set({ payment: { id: payment.id, method: 'card' } })
} catch (error) {
  scope.error(error)
}

scope.emit()
// One event with all context + duration
```

---

## Philosophy

logscope is built on a set of strong opinions about what logging should be. These aren't arbitrary constraints — they emerge from real production pain.

### Structured Data, Not Strings

Traditional logging treats log output as human-readable text:

```
[2024-01-15 10:30:00] ERROR: Payment failed for user 123, order abc, reason: card_declined
```

This is fine when you're tailing a log file. It falls apart the moment you need to _query_ your logs. Want to find all payment failures for premium users in the last hour? You're writing regex against unstructured text. Want to build a dashboard of failure rates by payment method? You're parsing strings.

logscope treats every log as structured data from the start. The message is optional context for humans. The properties are the actual data:

```typescript
log.error('payment failed', {
  userId: '123',
  orderId: 'abc',
  reason: 'card_declined',
  amount: 99.99,
  paymentMethod: 'card',
})
```

This is queryable, indexable, and machine-readable without any parsing. Your log aggregator (Datadog, Elasticsearch, Loki) can filter, group, and aggregate on any field.

### Wide Events Over Scattered Logs

The traditional approach to logging a request looks like this:

```
10:30:00.001 INFO  Request received: POST /checkout
10:30:00.015 INFO  User loaded: id=123, plan=premium
10:30:00.042 INFO  Cart validated: items=3, total=99.99
10:30:00.089 INFO  Payment processed: method=card
10:30:00.091 INFO  Response sent: status=200
```

Five log lines for one request. To understand what happened, you need to correlate all five — hoping nothing interleaved from another request on the same thread. This is the "Logging Sucks" problem that [Charity Majors articulated](https://www.honeycomb.io/blog/how-are-structured-logs-different-from-events): scattered logs are a poor approximation of what actually happened.

The alternative is the **wide event**: one rich, structured event per unit of work. Instead of logging each step as a separate message, you accumulate context as the work progresses and emit everything at the end:

```typescript
const scope = log.scope({ method: 'POST', path: '/checkout' })
scope.set({ user: { id: '123', plan: 'premium' } })
scope.set({ cart: { items: 3, total: 99.99 } })
scope.set({ payment: { method: 'card', status: 'success' } })
scope.emit()
// One event: method, path, user, cart, payment, duration — all together
```

One event, arbitrarily wide, containing everything you need. No correlation required. No interleaving risk. Duration is computed automatically. This is how observability tools like Honeycomb are designed to be used — and logscope makes it natural at the library level.

logscope doesn't force you to choose. Quick structured logs (`log.info(...)`) are equally first-class for point-in-time events. Wide events are for units of work.

### Library-First

Most logging libraries assume they own the application. They initialize on import, write to stdout by default, and expect to be the single logging solution in the process.

This breaks libraries. If your library uses a logging framework that writes to stdout by default, every consumer of your library gets unwanted output. If two libraries use different logging frameworks, the consumer has two logging systems to configure.

logscope inverts this. It is designed so that **library authors are the primary users**:

- When unconfigured, every logging call is a no-op. No output, no errors, no side effects, no performance overhead beyond a function call that returns immediately.
- Library authors instrument their code freely with `createLogger()`. They never call `configure()`.
- Application developers call `configure()` once at their entry point, choosing which libraries' logs they want to see and where those logs should go.
- Multiple libraries can use logscope independently. The application wires them all together through a single configuration.

### Zero Dependencies

logscope has no runtime dependencies. None. Not even a utility library.

This is a deliberate constraint, not an oversight. Every dependency is a supply chain risk, a version conflict waiting to happen, and a bundle size cost. For a library that other libraries depend on, the dependency count matters exponentially — every transitive dependency your logging library pulls in becomes a transitive dependency for every consumer.

logscope uses platform APIs directly: `console` for output, `WritableStream` for stream sinks, `AsyncLocalStorage` for implicit context, `Date.now()` for timestamps, ANSI escape codes for colors. Where runtime-specific APIs differ (Node's `util.inspect` vs Deno's `Deno.inspect`), conditional exports provide the right implementation without bundling alternatives.

### Simple Sinks

A sink is just a function:

```typescript
type Sink = (record: LogRecord) => void
```

That's the entire contract. No base classes, no interfaces to implement, no lifecycle methods to override. A custom sink is a one-liner:

```typescript
const mySink = (record) => fetch('/api/logs', { method: 'POST', body: JSON.stringify(record) })
```

Batching, retry, backoff, and buffering are separate composable utilities (`createPipeline`, `fingersCrossed`) that wrap sinks. They're opt-in, not baked into the core. If you need a simple sink, you write a simple function. If you need a production pipeline with retry and batching, you compose it from building blocks.

---

## Core Concepts

### Log Levels

Six levels, from lowest to highest severity:

| Level     | Use Case                             |
| --------- | ------------------------------------ |
| `trace`   | Fine-grained diagnostic info         |
| `debug`   | Development-time debugging           |
| `info`    | Normal operational events            |
| `warning` | Something unexpected but recoverable |
| `error`   | Something failed                     |
| `fatal`   | Application cannot continue          |

Every logger method corresponds to a level: `log.trace()`, `log.debug()`, `log.info()`, `log.warning()` (alias: `log.warn()`), `log.error()`, `log.fatal()`.

When you configure a logger with a `level`, it only emits records at that level or above. Setting `level: 'warning'` silences `trace`, `debug`, and `info`.

### LogRecord

The `LogRecord` is the immutable data structure that flows through the system — from loggers through filters to sinks:

```typescript
interface LogRecord {
  category: readonly string[]     // e.g., ['my-app', 'db']
  level: LogLevel                 // 'trace' | 'debug' | ... | 'fatal'
  timestamp: number               // Date.now() milliseconds
  message: readonly unknown[]     // Interleaved message parts
  rawMessage: string              // Original message template string
  properties: Record<string, unknown>  // Structured data
}
```

Records are created by loggers and passed to sinks. They are never modified after creation.

---

## Child Loggers and the Category Tree

Categories are the backbone of logscope's routing system. Every logger has a category — an array of strings that positions it in a tree. Child loggers extend their parent's category with an additional segment:

```typescript
const app = createLogger('my-app')            // category: ['my-app']
const db = app.child('db')                    // category: ['my-app', 'db']
const queries = db.child('queries')           // category: ['my-app', 'db', 'queries']
const auth = app.child('auth')                // category: ['my-app', 'auth']
```

This tree structure serves two purposes: **routing** (directing logs to the right sinks) and **filtering** (controlling verbosity at different granularities).

### Sink Inheritance

By default, sinks are **additive** — a child logger sends records to its own sinks _and_ all of its ancestors' sinks. This means you can configure a sink at the root and every descendant logger will use it:

```typescript
await configure({
  sinks: {
    console: getConsoleSink(),
    file: getStreamSink(fileStream),
  },
  loggers: [
    // All logs under 'my-app' go to console
    { category: 'my-app', level: 'info', sinks: ['console'] },
    // DB logs ALSO go to file (in addition to inheriting console from parent)
    { category: ['my-app', 'db'], level: 'debug', sinks: ['file'] },
  ],
})

const db = createLogger(['my-app', 'db'])
db.info('query executed', { table: 'users' })
// Sent to BOTH 'file' (own sink) AND 'console' (inherited from parent)
```

Sometimes you want a subtree to have completely independent output — for example, sending database logs only to a dedicated file and nowhere else. The `parentSinks: 'override'` option stops sink inheritance:

```typescript
await configure({
  sinks: {
    console: getConsoleSink(),
    dbFile: getStreamSink(dbFileStream),
  },
  loggers: [
    { category: 'my-app', level: 'info', sinks: ['console'] },
    // DB logs go ONLY to dbFile — parent console sink is not inherited
    { category: ['my-app', 'db'], level: 'debug', sinks: ['dbFile'], parentSinks: 'override' },
  ],
})
```

### Filter Inheritance

Filters use a "nearest wins" strategy. When a record is emitted, logscope checks if the emitting logger has its own filters. If it does, only those filters are consulted. If it doesn't, the check walks up to the parent, then the grandparent, until it finds a logger with filters or reaches the root. If no filters exist anywhere in the chain, the record passes.

This means a child logger with its own filters _replaces_ its parent's filters for its entire subtree — it doesn't add to them:

```typescript
await configure({
  sinks: { console: getConsoleSink() },
  filters: {
    slowOnly: (record) => (record.properties.duration as number) > 100,
    errorsOnly: (record) => record.level === 'error' || record.level === 'fatal',
  },
  loggers: [
    // Parent: only slow operations
    { category: 'my-app', sinks: ['console'], filters: ['slowOnly'] },
    // Child: only errors (parent's slowOnly filter is NOT applied here)
    { category: ['my-app', 'db'], sinks: ['console'], filters: ['errorsOnly'] },
  ],
})
```

### Memory Safety with WeakRef

Child loggers are stored as `WeakRef` references in the tree. This prevents memory leaks in long-running processes that dynamically create many loggers (e.g., one per request). When a logger goes out of scope and no other code holds a reference to it, the garbage collector can reclaim it.

Configured loggers (those with sinks or filters attached via `configure()`) are kept alive by a strong reference set, so they won't be collected while the configuration is active. Unconfigured loggers that are created and discarded — like a logger created inside a request handler — will be cleaned up naturally.

### Shared Tree Nodes

Multiple calls to `createLogger()` with the same category return loggers backed by the same internal tree node. This means configuration applied to a category is visible to all loggers created for that category, regardless of when they were created:

```typescript
// In module A (loaded at import time)
const log = createLogger(['my-app', 'db'])

// In the app entry point (loaded later)
await configure({
  sinks: { console: getConsoleSink() },
  loggers: [{ category: ['my-app', 'db'], level: 'debug', sinks: ['console'] }],
})

// module A's logger now outputs to console — even though it was created before configure()
log.info('this works')
```

The root logger is a singleton stored via `Symbol.for('logscope.rootLogger')` on `globalThis`. This ensures that even if multiple copies of logscope are loaded in the same process (e.g., different versions via npm deduplication failures), they share the same tree.

---

## Scoped Wide Events

Scopes are logscope's implementation of the wide event pattern. Instead of emitting many small log records throughout an operation, you create a scope, accumulate context as the work progresses, and emit a single comprehensive event at the end.

### Basic Usage

```typescript
const log = createLogger('api')

async function handleRequest(req) {
  const scope = log.scope({ method: req.method, path: req.url })

  const user = await loadUser(req)
  scope.set({ user: { id: user.id, plan: user.plan } })

  const result = await processRequest(req, user)
  scope.set({ result: { status: result.status, items: result.items.length } })

  scope.emit()
  // Emits one record with: method, path, user, result, and duration
}
```

### Duration Tracking

Every scope automatically tracks its duration. When `scope.emit()` is called, the elapsed time since `scope` was created is included as `properties.duration` in milliseconds. No manual timing required.

### Deep Merge Behavior

Each call to `scope.set()` deep-merges the new data into the accumulated context. Plain objects are merged recursively; arrays and primitives are replaced:

```typescript
const scope = log.scope()
scope.set({ user: { id: '123', name: 'Alice' } })
scope.set({ user: { plan: 'premium' } })
// Accumulated context: { user: { id: '123', name: 'Alice', plan: 'premium' } }

scope.set({ user: { plan: 'enterprise' } })
// Accumulated context: { user: { id: '123', name: 'Alice', plan: 'enterprise' } }
```

### Error and Warning Tracking

Scopes track severity. When you call `scope.error()`, the emitted record's level is elevated to `error`. When you call `scope.warn()`, it's elevated to `warning` (unless an error was also recorded, in which case `error` wins). If neither is called, the level defaults to `info`.

```typescript
const scope = log.scope({ method: 'POST', path: '/checkout' })

try {
  await processPayment(cart, user)
} catch (err) {
  // Normalizes Error into { name, message, stack, cause? }
  scope.error(err)
  // Also accepts a string:
  // scope.error('payment failed', { reason: 'timeout' })
}

scope.emit()
// Emitted record has level: 'error', with full error details in properties
```

### Request Logs

Calls to `scope.info()`, `scope.warn()`, and `scope.error()` are recorded as sub-events within the scope. These appear in the emitted record's `properties.requestLogs` array, providing a timeline of what happened within the unit of work:

```typescript
const scope = log.scope({ endpoint: '/api/checkout' })
scope.info('user loaded', { userId: '123' })
scope.info('cart validated', { items: 3 })
scope.warn('slow payment gateway', { latency: 2500 })
scope.emit()

// properties.requestLogs = [
//   { level: 'info', message: 'user loaded', context: { userId: '123' }, timestamp: ... },
//   { level: 'info', message: 'cart validated', context: { items: 3 }, timestamp: ... },
//   { level: 'warning', message: 'slow payment gateway', context: { latency: 2500 }, timestamp: ... },
// ]
```

### Property Priority

When a scope emits, properties are merged from multiple sources. If the same key exists in multiple sources, the higher-priority source wins:

1. **Implicit context** (`withContext`) — lowest priority
2. **Logger properties** (`.with()`) — overrides implicit context
3. **Scope context** (`.set()`) — overrides logger properties
4. **Overrides** (`scope.emit({ ... })`) — highest priority

```typescript
withContext({ env: 'prod', requestId: 'req_1' }, () => {
  const log = createLogger('app').with({ service: 'checkout' })
  const scope = log.scope({ requestId: 'req_2' })  // overrides withContext's requestId
  scope.emit({ final: true })  // highest priority
})
```

---

## Context System

logscope provides two ways to attach reusable properties to log records: **explicit context** via `.with()` and **implicit context** via `withContext()`.

### Explicit Context with `.with()`

`.with()` creates a new logger wrapper that attaches the given properties to every log record it emits:

```typescript
const log = createLogger('api')
const reqLog = log.with({ requestId: 'req_abc', userId: '123' })

reqLog.info('processing started')  // requestId and userId attached
reqLog.info('step completed')      // same context, no repetition

// .with() chains — each call adds more properties
const detailedLog = reqLog.with({ traceId: 'trace_xyz' })
detailedLog.info('detail')  // requestId, userId, AND traceId attached
```

`.with()` returns a new `Logger` — the original logger is unaffected. The child and scope methods carry the context forward:

```typescript
const reqLog = log.with({ requestId: 'req_abc' })
const dbLog = reqLog.child('db')  // child inherits requestId context
const scope = reqLog.scope()      // scope inherits requestId context
```

### Implicit Context with `withContext()`

For request-scoped context that should apply to _all_ loggers (not just one), use `withContext()`. It leverages `AsyncLocalStorage` to propagate context through async call chains:

```typescript
import { configure, createLogger, withContext, getConsoleSink } from 'logscope'
import { AsyncLocalStorage } from 'node:async_hooks'

await configure({
  sinks: { console: getConsoleSink() },
  loggers: [{ category: 'my-app', level: 'debug', sinks: ['console'] }],
  contextLocalStorage: new AsyncLocalStorage(),
})

const userLog = createLogger(['my-app', 'users'])
const dbLog = createLogger(['my-app', 'db'])

function handleRequest(req, res) {
  withContext({ requestId: req.id }, () => {
    userLog.info('user loaded')  // requestId attached automatically
    dbLog.info('query executed')  // requestId attached here too

    withContext({ userId: req.userId }, () => {
      userLog.info('profile updated')  // both requestId and userId
    })
  })
}
```

Implicit context is invisible to loggers that don't use it. It requires no changes to function signatures and works across async boundaries.

### Category Prefixes with `withCategoryPrefix()`

SDK and library authors sometimes want to namespace their internal loggers without exposing that structure to consumers. `withCategoryPrefix()` prepends a prefix to all `createLogger()` calls within its scope:

```typescript
withCategoryPrefix('my-sdk', () => {
  const log = createLogger('http')    // category: ['my-sdk', 'http']
  const cache = createLogger('cache') // category: ['my-sdk', 'cache']

  withCategoryPrefix('internal', () => {
    const inner = createLogger('pool')  // category: ['my-sdk', 'internal', 'pool']
  })
})
```

Like `withContext`, this requires `contextLocalStorage` to be configured.

### Context Priority

When the same property key exists in multiple context sources, the most specific source wins:

```
implicit context (withContext) < explicit context (.with()) < message properties
```

```typescript
withContext({ source: 'implicit' }, () => {
  const log = createLogger('app').with({ source: 'explicit' })
  log.info('test', { source: 'message' })
  // properties.source === 'message' (message wins)
})
```

---

## Sinks

A sink is a function that receives a `LogRecord` and does something with it. That's the entire contract:

```typescript
type Sink = (record: LogRecord) => void
```

### Built-in Sinks

**`getConsoleSink(options?)`** — Outputs to the console, mapping levels to the appropriate console method (`console.debug`, `console.info`, `console.warn`, `console.error`). Accepts an optional `formatter` to control how records are rendered as strings.

```typescript
import { getConsoleSink, getJsonFormatter } from 'logscope'

// Default format
getConsoleSink()

// With a custom formatter
getConsoleSink({ formatter: getJsonFormatter() })
```

**`getNonBlockingConsoleSink(options?)`** — Like `getConsoleSink`, but buffers output and drains it asynchronously via `setTimeout(0)`. This yields the event loop between your application code and log I/O, preventing high-throughput logging from stalling request handling. Returns a `DisposableSink` — call `flush()` on shutdown to ensure all buffered output is written.

```typescript
const sink = getNonBlockingConsoleSink()
// Use as normal — output is batched and flushed asynchronously
```

**`getStreamSink(stream, options?)`** — Writes formatted log records as UTF-8 lines to a `WritableStream`. Built on `fromAsyncSink`, so writes are ordered and the returned sink supports `flush()` and `Symbol.asyncDispose`.

```typescript
import { getStreamSink } from 'logscope'

const fileStream = new WritableStream({ /* ... */ })
const sink = getStreamSink(fileStream, { formatter: getJsonFormatter() })
```

### Custom Sinks

Because a sink is just a function, custom sinks are trivial:

```typescript
await configure({
  sinks: {
    // Inline sink definition
    myApi: (record) => {
      fetch('/api/logs', {
        method: 'POST',
        body: JSON.stringify(record),
      })
    },
  },
  loggers: [{ category: 'my-app', sinks: ['myApi'] }],
})
```

### Per-Sink Filtering with `withFilter()`

Sometimes you want a sink to receive only certain records — for example, a Slack webhook that should only fire on errors. `withFilter()` wraps a sink with a filter predicate:

```typescript
import { getConsoleSink, withFilter } from 'logscope'

await configure({
  sinks: {
    all: getConsoleSink(),
    errorsOnly: withFilter(getConsoleSink(), 'error'), // Only error+fatal
    slowQueries: withFilter(getConsoleSink(), (record) => {
      return (record.properties.duration as number) > 1000
    }),
  },
  loggers: [{ category: 'my-app', sinks: ['all', 'errorsOnly', 'slowQueries'] }],
})
```

`withFilter` accepts a `FilterLike` — a `Filter` function, a `LogLevel` string (filters to that level and above), or `null` (passes everything).

### Bridging Async Sinks with `fromAsyncSink()`

The `Sink` type is synchronous by design — logging should never block your application. But some destinations (files, HTTP endpoints, databases) are inherently async. `fromAsyncSink()` bridges the gap:

```typescript
import { fromAsyncSink } from 'logscope'

const sink = fromAsyncSink(async (record) => {
  await db.insert('logs', record)
})
```

Internally, `fromAsyncSink` chains promises so that writes execute in order and each write waits for the previous one to finish. The returned sink is synchronous (safe to use in `configure()`), and exposes `flush()` and `Symbol.asyncDispose` for lifecycle management.

### DisposableSink

Several built-in sinks (`getNonBlockingConsoleSink`, `getStreamSink`, `fromAsyncSink`, `createPipeline`, `createBrowserDrain`) return a `DisposableSink`:

```typescript
type DisposableSink = Sink & {
  flush(): Promise<void>
  [Symbol.asyncDispose](): Promise<void>
}
```

This supports both explicit cleanup and the `await using` pattern:

```typescript
await using sink = createPipeline({ /* ... */ })
// sink is automatically flushed when it goes out of scope
```

When you pass a `DisposableSink` to `configure()`, logscope automatically calls its disposal function during `reset()` or `dispose()`.

---

## Formatters

Formatters control how `LogRecord` objects are rendered as strings. They are used by sinks like `getConsoleSink()` and `getStreamSink()`.

```typescript
type TextFormatter = (record: LogRecord) => string
```

### `getTextFormatter()`

Human-readable text, suitable for development and simple production setups:

```
2024-01-15T10:30:00.000Z [INFO] my-app · db: query executed {table: "users", ms: 42}
```

```typescript
getConsoleSink({ formatter: getTextFormatter() })
```

### `getJsonFormatter()`

NDJSON (newline-delimited JSON), one object per line. Ideal for log aggregators like Datadog, Elasticsearch, or Loki:

```json
{"@timestamp":"2024-01-15T10:30:00.000Z","level":"INFO","logger":"my-app.db","message":"query executed","properties":{"table":"users","ms":42}}
```

```typescript
getConsoleSink({ formatter: getJsonFormatter() })
```

### `getAnsiColorFormatter()`

Colored terminal output using raw ANSI escape codes. Level colors: trace=gray, debug=cyan, info=green, warning=yellow, error=red, fatal=red+bold. Timestamps are dimmed, categories are bold:

```typescript
getConsoleSink({ formatter: getAnsiColorFormatter() })
```

### `getPrettyFormatter()`

Dev-friendly formatter designed for wide events. When a record has many or nested properties, they are rendered as a visual tree with box-drawing characters. Small property sets (3 or fewer primitive values) are rendered inline:

```
INFO my-app · api  2024-01-15T10:30:00.000Z
├── method: POST
├── path: /checkout
├── user:
│   ├── id: 123
│   └── plan: premium
├── cart:
│   ├── items: 3
│   └── total: 99.99
└── duration: 247
```

```typescript
getConsoleSink({ formatter: getPrettyFormatter() })
```

### `getAutoFormatter()`

Automatically selects `getPrettyFormatter()` in development and `getJsonFormatter()` in production. Detection checks `NODE_ENV` (Node/Bun) or `DENO_ENV` (Deno). Defaults to pretty (dev) when detection fails.

```typescript
getConsoleSink({ formatter: getAutoFormatter() })
```

You can override the detection:

```typescript
getAutoFormatter({ production: true })  // Force JSON
getAutoFormatter({ production: false }) // Force pretty
```

---

## Filters

Filters are predicate functions that decide whether a record should be forwarded to sinks:

```typescript
type Filter = (record: LogRecord) => boolean
```

Filters are configured per-logger and use "nearest wins" inheritance (see [Child Loggers](#child-loggers-and-the-category-tree)).

```typescript
await configure({
  sinks: { console: getConsoleSink() },
  filters: {
    slowOnly: (record) => (record.properties.duration as number) > 100,
  },
  loggers: [{ category: 'my-app', sinks: ['console'], filters: ['slowOnly'] }],
})
```

For convenience, `FilterLike` accepts a `LogLevel` string (converted to a level-based filter) or `null` (passes everything):

```typescript
import { getLevelFilter, toFilter } from 'logscope'

// These are equivalent:
const filter = getLevelFilter('warning')
const filter2 = toFilter('warning')
// Both return: (record) => record.level >= 'warning'
```

---

## Pipeline

For production log delivery to external services, `createPipeline()` wraps an async batch sink with batching, buffering, and retry:

```typescript
import { createPipeline } from 'logscope'

const pipeline = createPipeline({
  sink: async (batch) => {
    await fetch('https://logs.example.com/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
    })
  },
  batch: {
    size: 100,       // Max records per batch before auto-flush (default: 100)
    intervalMs: 5000, // Max ms to wait before flushing an incomplete batch (default: 5000)
  },
  maxBufferSize: 10000,  // Max records to buffer before dropping oldest (default: 10000)
  maxAttempts: 3,        // Retry attempts per batch including the first (default: 3)
  backoff: 'exponential', // 'exponential' | 'linear' | 'fixed' (default: 'exponential')
  baseDelayMs: 1000,     // Base delay for backoff calculation (default: 1000)
  onDropped: (batch, error) => {
    console.error(`Dropped ${batch.length} records:`, error)
  },
})

await configure({
  sinks: { remote: pipeline },
  loggers: [{ category: 'my-app', sinks: ['remote'] }],
})
```

### How It Works

1. Records are buffered synchronously (the pipeline is a normal `Sink`).
2. When the buffer reaches `batch.size` or `batch.intervalMs` elapses, a batch is drained and sent to the async sink.
3. If the send fails, it's retried with the configured backoff strategy up to `maxAttempts` times.
4. If all retries fail, `onDropped` is called and the batch is discarded.
5. If the buffer exceeds `maxBufferSize`, the oldest records are dropped (and `onDropped` is called with the dropped records).

### Backoff Strategies

| Strategy      | Behavior                                         | Example (base: 1000ms) |
| ------------- | ------------------------------------------------ | ---------------------- |
| `exponential` | Doubles each attempt: `base * 2^attempt`         | 1s, 2s, 4s, 8s        |
| `linear`      | Increases by base each attempt: `base * (n + 1)` | 1s, 2s, 3s, 4s        |
| `fixed`       | Same delay every attempt: `base`                 | 1s, 1s, 1s, 1s        |

### Graceful Shutdown

The pipeline returns a `DisposableSink`. Call `flush()` on shutdown to drain remaining buffered records and wait for all pending sends to complete:

```typescript
// Explicit
await pipeline.flush()

// Or with await using
await using pipeline = createPipeline({ /* ... */ })
```

---

## Sampling

High-throughput systems can produce more log volume than is practical to store and process. `createSamplingFilter()` provides probabilistic sampling with an important twist: **tail sampling is checked before head sampling**.

```typescript
import { createSamplingFilter } from 'logscope'

const sampling = createSamplingFilter({
  rates: {
    trace: 0.01,   // Keep 1% of trace logs
    debug: 0.1,    // Keep 10% of debug logs
    info: 0.5,     // Keep 50% of info logs
    // warning, error, fatal default to 1.0 (keep all)
  },
  keepWhen: [
    // Always keep records with HTTP 5xx status
    (record) => (record.properties.status as number) >= 500,
    // Always keep slow operations
    (record) => (record.properties.duration as number) > 2000,
  ],
})

await configure({
  sinks: { console: getConsoleSink() },
  filters: { sampling },
  loggers: [{ category: 'my-app', sinks: ['console'], filters: ['sampling'] }],
})
```

### Why Tail-Before-Head Matters

Head sampling decides whether to keep a record based on probability alone — before looking at the content. This is cheap but blind: you might drop the one debug log that would have explained a production incident.

Tail sampling looks at the content first. The `keepWhen` conditions are evaluated **before** the probabilistic check. If any condition matches, the record is kept unconditionally, regardless of head sampling rates. This ensures you never drop important signals.

The order matters: if head sampling ran first and dropped a record, tail conditions would never see it. By running tail conditions first, logscope guarantees that important records are preserved even at aggressive sampling rates.

---

## Fingers Crossed

The "fingers crossed" pattern is for situations where you want debug-level context but only when something goes wrong. Under normal operation, the sink silently buffers all records. When a high-severity record arrives (the "trigger"), the entire buffer is flushed, giving you full context leading up to the problem.

```typescript
import { fingersCrossed, getConsoleSink } from 'logscope'

const sink = fingersCrossed(getConsoleSink(), {
  triggerLevel: 'error',  // Flush buffer on error or fatal (default: 'error')
  bufferSize: 500,        // Max buffered records before oldest are dropped (default: 1000)
  afterTrigger: 'passthrough', // 'passthrough' | 'reset' (default: 'passthrough')
})
```

### After-Trigger Behavior

- **`passthrough`** (default) — After the first trigger, all subsequent records are forwarded immediately without buffering. The system is "open" for the rest of its lifetime.
- **`reset`** — After flushing, the buffer is cleared and buffering resumes until the next trigger. Useful for per-request isolation where you want independent trigger behavior for each request.

### Buffer Isolation

By default, `fingersCrossed` maintains a single global buffer. For multi-tenant or per-request scenarios, isolation provides separate buffers keyed by a function of the record.

**Category isolation** — separate buffer per logger category:

```typescript
import { fingersCrossed, categoryIsolation, getConsoleSink } from 'logscope'

const sink = fingersCrossed(getConsoleSink(), {
  isolation: categoryIsolation({ flush: 'descendants' }),
  afterTrigger: 'reset',
})
```

**Property isolation** — separate buffer per record property (e.g., requestId):

```typescript
import { fingersCrossed, propertyIsolation, getConsoleSink } from 'logscope'

const sink = fingersCrossed(getConsoleSink(), {
  isolation: propertyIsolation('requestId', { maxContexts: 500 }),
  afterTrigger: 'reset',
})
```

With isolation, a trigger in one buffer does not affect others. Each unique key gets its own independent buffer. When the number of buffers exceeds `maxContexts`, the least-recently-used untriggered buffer is evicted.

### Flush Related Buffers

When using isolation, the `flushRelated` option controls which related buffers are also flushed when a trigger fires. It uses prefix matching on buffer keys:

| Mode          | Behavior                                                                        |
| ------------- | ------------------------------------------------------------------------------- |
| `exact`       | Only the buffer matching the trigger's key (default)                            |
| `descendants` | Also flush buffers whose key starts with the trigger key (children in the tree) |
| `ancestors`   | Also flush buffers that are prefixes of the trigger key (parents in the tree)   |
| `both`        | Flush both descendants and ancestors                                            |

```typescript
// An error in 'app.db' also flushes 'app.db.queries' and 'app.db.connections'
categoryIsolation({ flush: 'descendants' })
```

---

## Browser Drain

Logging in the browser has three problems that don't exist on the server:

1. **Page unload** — When the user closes the tab or navigates away, the page is torn down. Any buffered logs not yet sent are lost.
2. **Visibility change** — When the user switches tabs, the browser may throttle or suspend the page. There's no guarantee it will become visible again.
3. **Network overhead** — Sending an HTTP request for every log record is wasteful. Batching is essential.

`createBrowserDrain()` solves all three:

```typescript
import { configure, createBrowserDrain, getAutoFormatter } from 'logscope'

await configure({
  sinks: {
    remote: createBrowserDrain({
      endpoint: '/api/logs',
      headers: { Authorization: 'Bearer token' },
      batch: { size: 25, intervalMs: 10_000 },
    }),
  },
  loggers: [{ category: 'my-app', sinks: ['remote'], level: 'info' }],
})
```

### How It Works

- **Normal operation** — Records are buffered and sent in batches via `fetch` with `keepalive: true` (which tells the browser to complete the request even if the page is being unloaded).
- **Visibility change** — When the page becomes hidden (user switches tabs), the buffer is flushed synchronously via `sendBeacon`.
- **Page unload** — On the `pagehide` event, all buffered records are sent via `navigator.sendBeacon` (a fire-and-forget API guaranteed to deliver during page unload). If `sendBeacon` is unavailable, falls back to `keepalive` fetch.
- **Buffer overflow** — When the buffer exceeds `maxBufferSize`, the oldest records are dropped and `onDropped` is called.

The drain returns a `DisposableSink` for SPA cleanup — call `flush()` when unmounting the app to ensure all records are sent.

---

## Configuration

### Type-Safe Config

The `configure()` function uses TypeScript generics so that sink and filter names referenced in logger configs are checked at compile time:

```typescript
await configure({
  sinks: {
    console: getConsoleSink(),
    file: getStreamSink(fileStream),
  },
  filters: {
    slow: (record) => (record.properties.duration as number) > 100,
  },
  loggers: [
    { category: 'my-app', sinks: ['console', 'file'], filters: ['slow'] },
    // TypeScript error: '"typo"' is not assignable to '"console" | "file"'
    { category: 'other', sinks: ['typo'] },
  ],
})
```

### Reconfiguration

Calling `configure()` when logscope is already configured throws a `ConfigError`. To reconfigure, either call `reset()` first or pass `reset: true`:

```typescript
import { configure, reset, dispose, isConfigured } from 'logscope'

// Check state
isConfigured() // true/false

// Reset and reconfigure
await configure({ ...newConfig, reset: true })

// Or manually
reset()
await configure(newConfig)

// dispose() is an alias for reset()
dispose()
```

`reset()` wipes the entire logger tree — all sinks, filters, and level overrides are removed, returning every logger to its silent unconfigured state. Disposable sinks are cleaned up automatically.

### Meta Logger

logscope auto-configures a meta logger at category `['logscope', 'meta']` with a console sink. When a sink throws an error during log emission, the error is caught (logging should never crash your application) and reported to this meta logger. A `bypassSinks` mechanism prevents infinite recursion if the meta logger's own sink fails.

### Implicit Context Storage

To use `withContext()` and `withCategoryPrefix()`, pass an `AsyncLocalStorage` instance in the configuration:

```typescript
import { AsyncLocalStorage } from 'node:async_hooks'

await configure({
  sinks: { console: getConsoleSink() },
  loggers: [{ category: 'my-app', level: 'debug', sinks: ['console'] }],
  contextLocalStorage: new AsyncLocalStorage(),
})
```

This is optional. Without it, `withContext()` and `withCategoryPrefix()` simply run their callbacks normally without context injection. All other logging features work without it.

### Duplicate Category Detection

`configure()` throws a `ConfigError` if two logger configs specify the same category. This prevents ambiguous configuration where the order of logger configs would determine which one "wins."

---

## Runtime Support

logscope works everywhere JavaScript runs:

- Node.js (>= 24)
- Deno
- Bun
- Browsers
- Edge functions (Cloudflare Workers, Vercel Edge, etc.)

Runtime-specific functionality (like `util.inspect` for pretty-printing objects) is handled via conditional exports in `package.json`. The browser and edge bundles use a lightweight `JSON.stringify`-based fallback.

---

## API Reference Summary

### Logger Creation

| Function | Description |
| --- | --- |
| `createLogger(category)` | Create a logger. Accepts `string` or `string[]` |
| `logger.child(subcategory)` | Create a child logger extending the category |
| `logger.with(properties)` | Create a logger with attached context |
| `logger.scope(initialContext?)` | Create a scoped wide event |
| `logger.isEnabledFor(level)` | Check if any sinks exist for a level |

### Configuration

| Function | Description |
| --- | --- |
| `configure(config)` | Configure the logger tree (async) |
| `reset()` | Reset all configuration to silent |
| `dispose()` | Alias for `reset()` |
| `isConfigured()` | Check if logscope is configured |

### Sinks

| Function | Description |
| --- | --- |
| `getConsoleSink(options?)` | Console output, level-mapped methods |
| `getNonBlockingConsoleSink(options?)` | Async-buffered console output |
| `getStreamSink(stream, options?)` | Write to a `WritableStream` |
| `withFilter(sink, filter)` | Wrap a sink with a filter predicate |
| `fromAsyncSink(fn)` | Bridge an async function to a sync sink |
| `createPipeline(options)` | Batching + retry pipeline |
| `createBrowserDrain(options)` | Browser-optimized remote sink |
| `fingersCrossed(sink, options)` | Buffer-until-trigger pattern |

### Formatters

| Function | Description |
| --- | --- |
| `getTextFormatter(options?)` | Human-readable text |
| `getJsonFormatter(options?)` | NDJSON for log aggregators |
| `getAnsiColorFormatter(options?)` | Colored terminal output |
| `getPrettyFormatter(options?)` | Tree-formatted dev output |
| `getAutoFormatter(options?)` | Auto-detect dev vs production |
| `renderMessage(record)` | Render a record's message as a string |

### Filters and Sampling

| Function | Description |
| --- | --- |
| `getLevelFilter(level)` | Filter to records at or above a level |
| `toFilter(filterLike)` | Normalize a `FilterLike` to a `Filter` |
| `createSamplingFilter(options)` | Head + tail probabilistic sampling |

### Context

| Function | Description |
| --- | --- |
| `withContext(properties, callback)` | Run callback with implicit context |
| `withCategoryPrefix(prefix, callback)` | Run callback with category prefix |

### Isolation Helpers

| Function | Description |
| --- | --- |
| `categoryIsolation(options?)` | Key buffers by category |
| `propertyIsolation(name, options?)` | Key buffers by record property |

---

## Inspirations

logscope stands on the shoulders of:

- **[Logging Sucks](https://loggingsucks.com/)** / **Charity Majors** — The "wide events" philosophy: one rich event per unit of work, not scattered log lines.
- **[LogTape](https://github.com/dahlia/logtape)** — Library-first design, hierarchical categories, the realization that logging libraries should be silent by default.
- **[evlog](https://github.com/HugoRCD/evlog)** — Wide event accumulation, pretty terminal output, scoped logging.

## License

[MIT](./LICENSE)
