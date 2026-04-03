# 09 — OpenTelemetry Exporter with Mock Collector

A Hono HTTP server that exports structured logs via OTLP HTTP/JSON to a mock OpenTelemetry collector, demonstrating batched export, resource attributes, scope grouping, and retry behavior — all without needing a real collector.

## What it demonstrates

- **`createOtlpExporter()`** — batched log export to any OTLP-compatible backend
- **Resource attributes** — `service.name`, `service.version`, `deployment.environment` propagated on every record
- **Scope grouping** — records grouped by logger category (instrumentation scope) in the OTLP payload
- **OTLP log record format** — severity numbers, nanosecond timestamps, typed attributes (string, int, double, bool, array, kvlist)
- **Dual sinks** — console (immediate, colored) + OTLP (batched, over HTTP) in parallel
- **Batching** — logs buffer and flush every 3 seconds or when 5 records accumulate
- **`onDropped` callback** — fires when the buffer overflows (demonstrated by `/flood`)
- **Retry with backoff** — exponential backoff on failed export requests
- **Custom headers** — `Authorization: Bearer ...` sent with every request
- **Mock OTLP collector** — receives `POST /v1/logs`, parses `ExportLogsServiceRequest`, pretty-prints records
- **Hono middleware** — `@logscope/hono` for automatic request-scoped wide event logging

## How to run

```bash
# From the repository root
pnpm install
pnpm build
pnpm --filter example-otlp dev

# Or from this directory
pnpm dev
```

## Exercise the routes

```bash
# Simple GET — baseline request/response logging
curl http://localhost:3007/

# GET with params — user context added to scope
curl http://localhost:3007/users/42

# POST with body — request body logged on scope
curl -X POST http://localhost:3007/users \
  -H 'Content-Type: application/json' \
  -d '{"name": "Alice", "email": "alice@example.com"}'

# Slow endpoint — shows duration in emitted event
curl http://localhost:3007/slow

# Error route — throws, scope emits at error level
curl http://localhost:3007/error

# Warning route — 4xx with scope.warn()
curl http://localhost:3007/warn

# Flood route — 50 rapid logs, overflows buffer, triggers onDropped
curl http://localhost:3007/flood
```

## Expected output

The terminal shows **two streams of output**:

1. **Console sink** (immediate) — colored log lines as they happen
2. **Mock OTLP collector** (batched) — blue-framed batch receipts showing the OTLP payload structure

### OTLP batching in action

After a few `curl` requests, you'll see OTLP batches appear:

```
  ┌─ OTLP Batch #1 (5 records) auth=Bearer otlp-exam...
  │ Resource: service.name=example-otlp-app, service.version=1.0.0, deployment.environment=development
  │ Scope: my-app
  ├── [INFO] user signed in {userId=42} 2026-04-03T...
  ├── [INFO] query executed {table=users, ms=42} 2026-04-03T...
  └── ...
```

### Resource attributes

Every OTLP batch includes resource attributes that identify the service:
- `service.name` — the application name
- `service.version` — the application version
- `deployment.environment` — the deployment environment

### Scope grouping

Records from different loggers are grouped by their category into separate OTLP scopes:
- `my-app` — top-level application logs
- `my-app.db` — database-specific logs

### Buffer overflow demo

Hit `/flood` to send 50 logs with a `maxBufferSize` of 20. You'll see:
- Some batches successfully delivered to the mock collector
- `[otlp-sink] Dropped N records: ...` messages when the buffer overflows
