# 04 — Express Request Logging

An Express HTTP server with automatic request-scoped wide event logging via `@logscope/express`.

## What it demonstrates

- **`logscope()` middleware** — applied via `app.use()`, creates a scoped wide event per request
- **Automatic request context** — method, path, and requestId captured automatically
- **`req.scope`** — add context with `.set()` during request handling
- **`req.requestLogger`** — within-request structured logs with requestId attached
- **`req.requestId`** — access the auto-generated request ID
- **`POST` with body parsing** — request body logged on scope
- **Slow endpoint** — simulated latency shows duration tracking in the emitted event
- **Error handling** — Express error-handling middleware catches and logs errors at error level
- **Warning responses** — 4xx responses with `scope.warn()` emit at warning level
- **Pretty colored output** — `getAnsiColorFormatter()` for readable terminal output

## How to run

```bash
# From the repository root
pnpm install
pnpm build
pnpm --filter example-express dev

# Or from this directory
pnpm dev
```

## Exercise the routes

```bash
# Simple GET — baseline request/response logging
curl http://localhost:3002/

# GET with params — user context added to scope
curl http://localhost:3002/users/42

# POST with body — request body logged on scope
curl -X POST http://localhost:3002/users \
  -H 'Content-Type: application/json' \
  -d '{"name": "Alice", "email": "alice@example.com"}'

# Slow endpoint — shows duration in emitted event
curl http://localhost:3002/slow

# Error route — throws, scope emits at error level
curl http://localhost:3002/error

# Warning route — 4xx with scope.warn()
curl http://localhost:3002/warn

# Within-request logging — requestLogger emits separate structured logs
curl http://localhost:3002/users/42
```

## Expected output

Each request produces a single wide event in the terminal showing:
- Request method, path, and auto-generated requestId
- Any context added via `req.scope.set()` during handling
- Response status
- Duration (milliseconds from request start to response)
- Level escalation: `info` for success, `warning` for 4xx, `error` for thrown errors

Within-request logs from `req.requestLogger` appear as separate log lines with the requestId attached.
