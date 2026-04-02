# 01 — Core Basics

The simplest possible logscope example. A single Node.js script, no framework.

## What it demonstrates

- **`configure()`** with a console sink using `getAnsiColorFormatter()`
- **`createLogger()`** — basic `info`, `warn`, `error` calls
- **String messages with properties** — `log.info('user signed in', { userId: '123' })`
- **Properties-only logs** — `log.info({ action: 'page_view', path: '/home' })`
- **Child loggers** — `log.child('db')` with its own logs
- **`.with()` context** — properties carried through every log call
- **Scoped wide events** — `log.scope()` → `.set()` → `.emit()`
- **Level escalation** — `scope.error()` and `scope.warn()` change the emitted level
- **Hierarchical sink dispatch** — parent logger receives child logs
- **`parentSinks: 'override'`** — stop bubbling for one branch
- **JSON formatter** — `getJsonFormatter()` as a second sink
- **Cleanup** — `await dispose()`

## How to run

```bash
# From the repository root
pnpm install
pnpm build
pnpm --filter example-core-basics dev

# Or from this directory
pnpm dev
```

## Expected output

You should see colorized ANSI log output for most loggers, plus a few JSON-formatted lines from the `json` sink. The scoped wide event sections show accumulated context emitted as a single log record with duration.
