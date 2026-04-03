/**
 * 10-sentry — Sentry Error Tracking with Mock Endpoint
 *
 * Starts two servers:
 *   1. Mock Sentry envelope endpoint (port 3108) — receives and pretty-prints Sentry events
 *   2. Hono application (port 3008) — generates logs sent to both console and Sentry
 *
 * Usage:
 *   pnpm dev
 *   curl http://localhost:3008/error
 *
 * Watch the terminal for:
 *   - Colored console output (immediate, all levels)
 *   - Sentry event receipts (only error/fatal, batched)
 */

import { startMockSentry } from './mock-sentry.ts'
import { startApp, shutdown } from './app.ts'

// Start mock Sentry first so the sink has somewhere to send events
await startMockSentry(3108)

// Then start the app
await startApp()

// Graceful shutdown
process.on('SIGINT', shutdown)
