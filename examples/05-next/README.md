# 05 — Next.js Route Handlers & Server Actions

A minimal Next.js app with automatic request-scoped wide event logging via `@logscope/next`.

## What it demonstrates

- **`withLogscope()` wrapper** — wraps route handlers with a scoped wide event per request
- **Automatic request context** — method, path, and requestId captured automatically
- **`logscope.scope`** — add context with `.set()` during request handling
- **`logscope.requestLogger`** — within-request structured logs with requestId attached
- **`logscope.requestId`** — access the auto-generated request ID
- **`POST` with body parsing** — request body logged on scope
- **Error handling** — errors caught by `withLogscope`, scope emits at error level
- **`withLogscopeAction()`** — wraps server actions with scoped wide event logging
- **Server action form** — form submission triggers action with logscope instrumentation
- **Pretty colored output** — `getAnsiColorFormatter()` for readable terminal output

## How to run

```bash
# From the repository root
pnpm install
pnpm build
pnpm --filter example-next dev

# Or from this directory
pnpm dev
```

## Exercise the routes

```bash
# GET with params — user context added to scope
curl http://localhost:3003/api/users/42

# POST with body — request body logged on scope
curl -X POST http://localhost:3003/api/users \
  -H 'Content-Type: application/json' \
  -d '{"name": "Alice", "email": "alice@example.com"}'

# Error route — throws, scope emits at error level
curl http://localhost:3003/api/error
```

For the **server action**, open http://localhost:3003 in a browser and submit the form.

## Expected output

Each route handler request produces a single wide event in the terminal showing:
- Request method, path, and auto-generated requestId
- Any context added via `logscope.scope.set()` during handling
- Response status
- Duration (milliseconds from request start to response)
- Level escalation: `info` for success, `error` for thrown errors

Within-request logs from `logscope.requestLogger` appear as separate log lines with the requestId attached.

Server action submissions produce a wide event with the action name, accumulated form data, and duration.
