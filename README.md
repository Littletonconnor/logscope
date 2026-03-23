# logscope

Zero-dependency, universal, library-first structured logging with scoped wide events.

[![npm version](https://img.shields.io/npm/v/logscope?color=black)](https://npmjs.com/package/logscope)
[![license](https://img.shields.io/github/license/Littletonconnor/logscope?color=black)](https://github.com/Littletonconnor/logscope/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-black?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

---

**Your logs are lying to you.** Scattered `console.log` calls, unstructured strings, context spread across 20 log lines. When something breaks, you're grep-ing through noise hoping to find signal.

**logscope fixes this.** Every log is structured data. Quick logs emit immediately. Scoped logs accumulate context over a unit of work and emit once—with everything an engineer needs to understand what happened.

## Why logscope?

### The Problem

```typescript
// Scattered, unstructured, impossible to query
console.log('Request received')
console.log('User:', user.id)
console.log('Cart loaded, items:', cart.items.length)
console.log('Payment failed') // Good luck correlating this at 3am
```

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
// → One structured event with ALL context + duration
```

### Built for Libraries

Most logging libraries force configuration on consumers. logscope doesn't. When unconfigured, all logging is **completely silent**—zero output, zero errors, zero side effects.

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
  scope.error('payment failed', { reason: error.message })
}

scope.emit()
// → One event with all context + duration
```

## Core Concepts

### Hierarchical Categories

Loggers have categories that form a tree. Child loggers inherit from parents:

```typescript
const appLog = createLogger('my-app')
const dbLog = appLog.child('db') // category: ['my-app', 'db']
const authLog = appLog.child('auth') // category: ['my-app', 'auth']

// Configure different levels per category
await configure({
  sinks: { console: getConsoleSink() },
  loggers: [
    { category: 'my-app', level: 'info', sinks: ['console'] },
    { category: ['my-app', 'db'], level: 'warn' }, // only warnings+ from DB
  ],
})
```

### Context

Attach reusable properties to a logger:

```typescript
const reqLog = log.with({ requestId: 'req_abc', userId: '123' })

reqLog.info('processing started') // requestId and userId attached
reqLog.info('step completed') // same context, no repetition
```

### Sinks

A sink is just a function:

```typescript
type Sink = (record: LogRecord) => void
```

Built-in sinks:

- **`getConsoleSink()`** — outputs to `console.log` / `console.warn` / `console.error`

Custom sinks are trivial:

```typescript
await configure({
  sinks: {
    myApi(record) {
      fetch('/api/logs', {
        method: 'POST',
        body: JSON.stringify(record),
      })
    },
  },
  loggers: [{ category: 'my-app', sinks: ['myApi'] }],
})
```

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

### Filters

Filters are predicate functions on log records:

```typescript
await configure({
  sinks: { console: getConsoleSink() },
  filters: {
    slowOnly(record) {
      return record.properties.duration > 100
    },
  },
  loggers: [{ category: 'my-app', sinks: ['console'], filters: ['slowOnly'] }],
})
```

## Philosophy

Inspired by [Logging Sucks](https://loggingsucks.com/), [evlog](https://github.com/HugoRCD/evlog), and [LogTape](https://github.com/dahlia/logtape).

1. **Structured Data, Not Strings** — Every log is queryable, parseable, machine-readable
2. **Wide Events** — One comprehensive event per unit of work, not 20 scattered lines
3. **Library-First** — Safe for library authors. Unconfigured = silent
4. **Zero Dependencies** — No supply chain risk. Works everywhere
5. **Simple Sinks** — `(record) => void`. Compose complexity, don't bake it in

## Runtime Support

logscope works everywhere JavaScript runs:

- Node.js (>= 24)
- Deno
- Bun
- Browsers
- Edge functions (Cloudflare Workers, Vercel Edge, etc.)

## License

[MIT](./LICENSE)
