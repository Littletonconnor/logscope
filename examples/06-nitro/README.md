# 06 — Nitro Request Logging

A standalone Nitro server with automatic request-scoped wide event logging via `@logscope/nitro`.

## What it demonstrates

- **`logscope()` Nitro plugin** — hooks into `request`, `afterResponse`, and `error` lifecycle events
- **Automatic request context** — method, path, and requestId captured automatically
- **`event.context.logscope`** — access scope, requestLogger, and requestId in route handlers
- **`scope.set()`** — accumulate context during request handling
- **`requestLogger`** — within-request structured logs with requestId attached
- **`POST` with body parsing** — request body logged on scope
- **Slow endpoint** — simulated latency shows duration tracking in the emitted event
- **Error handling** — errors caught by the plugin's error hook emit at error level
- **Warning responses** — 4xx responses with `scope.warn()` emit at warning level
- **Pretty colored output** — `getAnsiColorFormatter()` for readable terminal output

## How to run

```bash
# From the repository root
pnpm install
pnpm build
pnpm --filter example-nitro dev

# Or from this directory
pnpm dev
```

## Exercise the routes

```bash
# Simple GET — baseline request/response logging
curl http://localhost:3000/

# GET with params — user context added to scope
curl http://localhost:3000/users/42

# POST with body — request body logged on scope
curl -X POST http://localhost:3000/users \
  -H 'Content-Type: application/json' \
  -d '{"name": "Alice", "email": "alice@example.com"}'

# Slow endpoint — shows duration in emitted event
curl http://localhost:3000/slow

# Error route — throws, scope emits at error level
curl http://localhost:3000/error

# Warning route — 4xx with scope.warn()
curl http://localhost:3000/warn
```

## Expected output

Each request produces a single wide event in the terminal showing:
- Request method, path, and auto-generated requestId
- Any context added via `scope.set()` during handling
- Response status
- Duration (milliseconds from request start to response)
- Level escalation: `info` for success, `warning` for 4xx, `error` for thrown errors

Within-request logs from `requestLogger` appear as separate log lines with the requestId attached.
