# 03 — Hono Request Logging

A Hono HTTP server with automatic request-scoped wide event logging via `@logscope/hono`.

## What it demonstrates

- **`logscope()` middleware** — applied globally, creates a scoped wide event per request
- **Automatic request context** — method, path, and requestId captured automatically
- **`c.get('scope')`** — add context with `.set()` during request handling
- **`c.get('requestLogger')`** — within-request structured logs with requestId attached
- **`c.get('requestId')`** — access the auto-generated request ID
- **`POST` with body parsing** — request body logged on scope
- **Slow endpoint** — simulated latency shows duration tracking in the emitted event
- **Error handling** — thrown errors auto-captured, scope emits at error level
- **Warning responses** — 4xx responses with `scope.warn()` emit at warning level
- **Custom context extractors** — `getRequestContext` and `getResponseContext` overrides
- **Pretty colored output** — `getAnsiColorFormatter()` for readable terminal output

## How to run

```bash
# From the repository root
pnpm install
pnpm build
pnpm --filter example-hono dev

# Or from this directory
pnpm dev
```

## Exercise the routes

```bash
# Simple GET — baseline request/response logging
curl http://localhost:3001/

# GET with params — user context added to scope
curl http://localhost:3001/users/42

# POST with body — request body logged on scope
curl -X POST http://localhost:3001/users \
  -H 'Content-Type: application/json' \
  -d '{"name": "Alice", "email": "alice@example.com"}'

# Slow endpoint — shows duration in emitted event
curl http://localhost:3001/slow

# Error route — throws, scope emits at error level
curl http://localhost:3001/error

# Warning route — 4xx with scope.warn()
curl http://localhost:3001/warn

# Within-request logging — requestLogger emits separate structured logs
curl http://localhost:3001/users/42
```

## Expected output

Each request produces a single wide event in the terminal showing:
- Request method, path, and auto-generated requestId
- Any context added via `scope.set()` during handling
- Response status
- Duration (milliseconds from request start to response)
- Level escalation: `info` for success, `warning` for 4xx, `error` for thrown errors

Within-request logs from `requestLogger` appear as separate log lines with the requestId attached.
