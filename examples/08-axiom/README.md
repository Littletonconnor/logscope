# 08 — Axiom Exporter with Mock Endpoint

A Hono HTTP server that sends structured logs to a mock Axiom ingest endpoint, demonstrating batched export, retry behavior, and buffer overflow handling — all without needing an Axiom account.

## What it demonstrates

- **`createAxiomSink()`** — batched log export to the Axiom Ingest API
- **Dual sinks** — console (immediate, colored) + Axiom (batched, over HTTP) in parallel
- **Batching** — logs buffer and flush every 3 seconds or when 5 records accumulate
- **Axiom event format** — mapped fields: `_time`, `level`, `logger`, plus all structured properties
- **`onDropped` callback** — fires when the buffer overflows (demonstrated by `/flood`)
- **Retry with backoff** — exponential backoff on failed ingest requests (try killing the mock server and restarting it)
- **Mock Axiom server** — receives `POST /v1/datasets/:dataset/ingest`, validates auth, pretty-prints events
- **Hono middleware** — `@logscope/hono` for automatic request-scoped wide event logging

## How to run

```bash
# From the repository root
pnpm install
pnpm build
pnpm --filter example-axiom dev

# Or from this directory
pnpm dev
```

## Exercise the routes

```bash
# Simple GET — baseline request/response logging
curl http://localhost:3006/

# GET with params — user context added to scope
curl http://localhost:3006/users/42

# POST with body — request body logged on scope
curl -X POST http://localhost:3006/users \
  -H 'Content-Type: application/json' \
  -d '{"name": "Alice", "email": "alice@example.com"}'

# Slow endpoint — shows duration in emitted event
curl http://localhost:3006/slow

# Error route — throws, scope emits at error level
curl http://localhost:3006/error

# Warning route — 4xx with scope.warn()
curl http://localhost:3006/warn

# Flood route — 50 rapid logs, overflows buffer, triggers onDropped
curl http://localhost:3006/flood
```

## Expected output

The terminal shows **two streams of output**:

1. **Console sink** (immediate) — colored log lines as they happen, just like the Hono example
2. **Mock Axiom** (batched) — purple-framed batch receipts showing the events as Axiom would receive them

### Batching in action

After a few `curl` requests, you'll see Axiom batches appear:

```
  ┌─ Axiom Batch #1 (5 events) dataset=example-logs token=xaat-exa...
  ├── [INFO] my-app user signed in  {"userId":"42"} 2026-04-03T...
  ├── [INFO] my-app.db query executed  {"table":"users","ms":42} 2026-04-03T...
  └── ...
```

### Buffer overflow demo

Hit `/flood` to send 50 logs with a `maxBufferSize` of 20. You'll see:
- Some batches successfully delivered to the mock Axiom server
- `[axiom-sink] Dropped N records: ...` messages when the buffer overflows

### Retry demo

1. Start the example normally: `pnpm dev`
2. Send a request: `curl http://localhost:3006/users/42`
3. Kill just the mock Axiom server (Ctrl+C won't work since both share a process — this is a conceptual exercise)
4. The Axiom sink will retry with exponential backoff (500ms, 1000ms, 2000ms) and eventually call `onDropped`
