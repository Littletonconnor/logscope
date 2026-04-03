/**
 * 09-otlp — OpenTelemetry Exporter with Mock Collector
 *
 * Starts two servers:
 *   1. Mock OTLP collector (port 3107) — receives and pretty-prints OTLP log payloads
 *   2. Hono application (port 3007) — generates logs sent to both console and OTLP
 *
 * Usage:
 *   pnpm dev
 *   curl http://localhost:3007/users/42
 *
 * Watch the terminal for:
 *   - Colored console output (immediate, per-log)
 *   - OTLP batch receipts (batched, every few seconds or when batch is full)
 */

import { startMockCollector } from './mock-collector.ts'
import { startApp, shutdown } from './app.ts'

// Start mock collector first so the exporter has somewhere to send logs
await startMockCollector(3107)

// Then start the app
await startApp()

// Graceful shutdown
process.on('SIGINT', shutdown)
