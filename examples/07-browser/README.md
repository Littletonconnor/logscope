# 07 — Browser Logging with Mock Ingest

A Vite SPA that demonstrates `createBrowserDrain` — logscope's browser-optimized sink that batches log records and sends them to a remote endpoint.

## What it demonstrates

- **`createBrowserDrain`** batching — logs buffer locally, flush after 5 records or 3 seconds
- **`sendBeacon` fallback** on page unload — close the tab and remaining logs are still delivered
- **`flushOnVisibilityChange`** — switch to another tab and the buffer auto-flushes
- **`keepalive: true` fetch** — requests complete even during page transitions
- **Console sink in parallel** — logs also appear in DevTools console
- **Interactive scope demo** — start a scope, accumulate context, emit a wide event
- **Mock ingest endpoint** — Vite plugin that receives batches and pretty-prints them to the terminal
- **Visual log panel** — see received batches rendered in the browser

## How to run

```bash
# From the repository root
pnpm install
pnpm build
pnpm --filter example-browser dev

# Or from this directory
pnpm dev
```

Then open [http://localhost:3005](http://localhost:3005).

## What to try

1. **Click log buttons** — watch logs appear in both the browser panel and your terminal
2. **Click rapidly** — once you hit 5 logs, the batch flushes immediately (before the 3s timer)
3. **Open DevTools Network tab** — observe `POST /api/ingest` requests with batched JSON payloads
4. **Switch to another tab** — the drain auto-flushes via `visibilitychange` event
5. **Start a scope** — click "Start Scope", then "Add Context" a few times, then "Emit Scope" to see a wide event with accumulated context and duration
6. **Close the tab** — check your terminal; remaining buffered logs are sent via `sendBeacon`

## Expected output

**Terminal** (Vite dev server) shows colorized log batches:

```
--- Ingest batch (3 records) ---
  2024-01-15T10:30:00.000Z INFO    browser-app: button clicked {"button":"info","count":1}
  2024-01-15T10:30:01.200Z WARNING browser-app: something looks off {"button":"warn","count":1}
  2024-01-15T10:30:02.500Z ERROR   browser-app: something went wrong {"button":"error","count":1}
```

**Browser** shows the same records in the right-hand panel, grouped by batch.
