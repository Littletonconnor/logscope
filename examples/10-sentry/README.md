# 10 — Sentry Error Tracking with Mock Endpoint

A Hono HTTP server that sends error logs to a mock Sentry endpoint, demonstrating error-only filtering, exception chains with stack traces, the Sentry envelope wire format, and batched export — all without needing a Sentry account.

## What it demonstrates

- **`createSentrySink()`** — batched error export to the Sentry Envelope API
- **Error-only filtering** — only `error` and `fatal` logs are sent to Sentry; info/warn/debug stay console-only
- **Exception chains** — nested `Error.cause` chains are fully serialized with stack traces
- **Stack trace parsing** — V8-style stack traces parsed into Sentry frames with `in_app` detection
- **Sentry envelope format** — newline-delimited JSON (envelope header + item header + event payload)
- **DSN parsing** — `https://<public_key>@<host>/<project_id>` broken down into endpoint + auth header
- **Environment and release tags** — attached to every Sentry event
- **Dual sinks** — console (all levels, colored) + Sentry (errors only, batched) in parallel
- **`onDropped` callback** — fires when the buffer overflows (demonstrated by `/flood`)
- **Mock Sentry server** — receives `POST /api/:projectId/envelope/`, parses envelopes, pretty-prints events
- **Hono middleware** — `@logscope/hono` for automatic request-scoped wide event logging

## How to run

```bash
# From the repository root
pnpm install
pnpm build
pnpm --filter example-sentry dev

# Or from this directory
pnpm dev
```

## Exercise the routes

```bash
# Simple GET — info level, appears in console only (NOT sent to Sentry)
curl http://localhost:3008/

# GET with params — info logs only, no Sentry events
curl http://localhost:3008/users/42

# Error route — throws, scope emits at error level → Sentry event with stack trace
curl http://localhost:3008/error

# Error with cause chain — nested errors, both appear in Sentry exception interface
curl http://localhost:3008/error/cause

# Explicit error log — uses requestLogger.error() with an Error object
curl http://localhost:3008/error/explicit

# Warning route — 4xx with scope.warn(), NOT sent to Sentry
curl http://localhost:3008/warn

# Slow endpoint — info level, console only
curl http://localhost:3008/slow

# Flood route — 50 rapid error logs, overflows buffer, triggers onDropped
curl http://localhost:3008/flood
```

## Expected output

The terminal shows **two streams of output**:

1. **Console sink** (immediate) — colored log lines for ALL levels
2. **Mock Sentry** (batched) — purple-framed event receipts showing only error/fatal events

### Error with stack trace

```
  ┌─ Sentry Event #1 project=12345 key=exampleP...
  │ [ERROR] my-app id=a1b2c3d4e5f6... 2026-04-03T...
  │ Message: Something went terribly wrong!
  │ Tags: environment=development, release=example-1.0.0
  │ Exception Chain:
  │  └── Error: Something went terribly wrong!
  │       at handler (file:///path/to/app.ts:123:9)
  │       ... 5 more frames
  └─
```

### Error cause chain

Hit `/error/cause` to see nested exceptions:

```
  │ Exception Chain:
  │  ├── DatabaseError: Connection refused: ECONNREFUSED 127.0.0.1:5432
  │  └── MigrationError: Migration "add_users_table" failed
```

### Filtering in action

- `curl http://localhost:3008/users/42` — info logs appear in console, **nothing** sent to Sentry
- `curl http://localhost:3008/error` — error log appears in console **and** triggers a Sentry event
- `curl http://localhost:3008/warn` — warning appears in console, **nothing** sent to Sentry

### Buffer overflow demo

Hit `/flood` to send 50 error logs with a `maxBufferSize` of 20. You'll see:
- Some batches successfully delivered to the mock Sentry server
- `[sentry-sink] Dropped N records: ...` messages when the buffer overflows
