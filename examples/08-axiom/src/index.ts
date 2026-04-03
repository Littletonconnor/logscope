/**
 * 08-axiom — Axiom Exporter with Mock Endpoint
 *
 * Starts two servers:
 *   1. Mock Axiom ingest server (port 3106) — receives and pretty-prints batched events
 *   2. Hono application (port 3006) — generates logs sent to both console and Axiom
 *
 * Usage:
 *   pnpm dev
 *   curl http://localhost:3006/users/42
 *
 * Watch the terminal for:
 *   - Colored console output (immediate, per-log)
 *   - Axiom batch receipts (batched, every few seconds or when batch is full)
 */

import { startMockAxiom } from './mock-axiom.ts'
import { startApp, shutdown } from './app.ts'

// Start mock Axiom first so the sink has somewhere to send events
await startMockAxiom(3106)

// Then start the app
await startApp()

// Graceful shutdown
process.on('SIGINT', shutdown)
