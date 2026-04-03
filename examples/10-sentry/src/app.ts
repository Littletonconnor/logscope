/**
 * Hono application with logscope + Sentry sink.
 *
 * Logs go to two sinks:
 *   1. Console — colorful ANSI output for ALL levels (immediate)
 *   2. Sentry — only error/fatal logs, batched export to the mock Sentry endpoint
 *
 * The Sentry sink uses createSentrySink() which converts LogRecords into
 * Sentry envelope events with full exception chains and parsed stack frames.
 * Only error/fatal logs are routed to Sentry via the level configuration.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { setTimeout } from 'node:timers/promises'

import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import {
  configure,
  createLogger,
  dispose,
  getAnsiColorFormatter,
  getConsoleSink,
  withFilter,
} from 'logscope'
import { createSentrySink } from '@logscope/sentry'
import { logscope } from '@logscope/hono'
import type { LogscopeVariables } from '@logscope/hono'

// ============================================================================
// 1. Configure logscope with console + Sentry sinks
// ============================================================================

const MOCK_SENTRY_PORT = 3108

// DSN format: https://<public_key>@<host>/<project_id>
// Points at our mock Sentry server
const MOCK_SENTRY_DSN = `https://examplePublicKey123@localhost:${MOCK_SENTRY_PORT}/12345`

const log = createLogger('my-app')

// Create the Sentry sink pointed at our mock server
const sentrySink = createSentrySink({
  dsn: MOCK_SENTRY_DSN,
  environment: 'development',
  release: 'example-1.0.0',
  batch: {
    size: 5, // Small batch size so you see flushes frequently
    intervalMs: 3000, // Flush every 3 seconds even if batch isn't full
  },
  maxBufferSize: 20, // Small buffer to demonstrate overflow
  maxAttempts: 3,
  backoff: 'exponential',
  baseDelayMs: 500,
  // Override fetch to use HTTP since our mock server is HTTP, not HTTPS
  fetch: (input, init) => {
    const url = String(input).replace('https://localhost:', `http://localhost:`)
    return globalThis.fetch(url, init)
  },
  onDropped: (batch, error) => {
    console.log(
      `\x1b[31m  [sentry-sink] Dropped ${batch.length} records: ${error}\x1b[39m`,
    )
  },
})

// Wrap the sentry sink with a filter so only error/fatal records are sent
const filteredSentrySink = withFilter(sentrySink, 'error')

await configure({
  sinks: {
    console: getConsoleSink({ formatter: getAnsiColorFormatter() }),
    sentry: filteredSentrySink,
  },
  loggers: [
    // Both sinks on one logger — sentry is filtered to error+ only
    { category: 'my-app', level: 'debug', sinks: ['console', 'sentry'] },
  ],
  contextLocalStorage: new AsyncLocalStorage<Record<string, unknown>>(),
})

// ============================================================================
// 2. Create the Hono app with logscope middleware
// ============================================================================

const app = new Hono<{ Variables: LogscopeVariables }>()

app.use(
  logscope({
    logger: log,
    getRequestContext: (c) => {
      const url = new URL(c.req.url)
      return {
        method: c.req.method,
        path: url.pathname,
        userAgent: c.req.header('user-agent') ?? 'unknown',
      }
    },
    getResponseContext: (c) => ({
      response: {
        status: c.res.status,
        contentType: c.res.headers.get('content-type') ?? 'unknown',
      },
    }),
  }),
)

// ============================================================================
// 3. Routes
// ============================================================================

// --- GET / — baseline route (info level, NOT sent to Sentry) ---
app.get('/', (c) => {
  return c.json({ message: 'Welcome to the logscope Sentry example!' })
})

// --- GET /users/:id — normal request, only console output ---
app.get('/users/:id', (c) => {
  const scope = c.get('scope')
  const requestLogger = c.get('requestLogger')
  const userId = c.req.param('id')

  scope.set({ user: { id: userId, source: 'url_param' } })
  requestLogger.info('fetching user from database', { userId })

  const user = { id: userId, name: 'Alice', plan: 'premium' }
  requestLogger.info('user found', { userId, plan: user.plan })
  scope.set({ user: { name: user.name, plan: user.plan } })

  return c.json(user)
})

// --- GET /error — throws an error, sent to Sentry with full stack trace ---
app.get('/error', (c) => {
  const scope = c.get('scope')
  scope.set({ action: 'dangerous_operation' })
  throw new Error('Something went terribly wrong!')
})

// --- GET /error/cause — throws an error with a cause chain ---
app.get('/error/cause', (c) => {
  const scope = c.get('scope')
  scope.set({ action: 'database_migration' })

  const dbError = new Error('Connection refused: ECONNREFUSED 127.0.0.1:5432')
  dbError.name = 'DatabaseError'

  const migrationError = new Error('Migration "add_users_table" failed', {
    cause: dbError,
  })
  migrationError.name = 'MigrationError'

  throw migrationError
})

// --- GET /error/explicit — logs an error explicitly without throwing ---
app.get('/error/explicit', (c) => {
  const requestLogger = c.get('requestLogger')

  const paymentError = new Error('Card declined: insufficient funds')
  paymentError.name = 'PaymentError'

  requestLogger.error('payment processing failed', {
    error: paymentError,
    orderId: 'order_abc123',
    amount: 99.99,
    currency: 'USD',
  })

  return c.json({ error: 'Payment failed', orderId: 'order_abc123' }, 402)
})

// --- GET /warn — returns 4xx with warning (NOT sent to Sentry) ---
app.get('/warn', (c) => {
  const scope = c.get('scope')
  scope.warn('resource not found — returning 404')
  scope.set({ lookup: { table: 'products', id: 'prod_999' } })
  return c.json({ error: 'Product not found' }, 404)
})

// --- GET /slow — simulated latency, info level only ---
app.get('/slow', async (c) => {
  const scope = c.get('scope')
  const requestLogger = c.get('requestLogger')

  requestLogger.info('starting slow operation')
  scope.set({ operation: 'heavy_computation' })

  await setTimeout(500)

  requestLogger.info('slow operation completed')
  scope.set({ result: { rowsProcessed: 10_000 } })

  return c.json({ status: 'done', rowsProcessed: 10_000 })
})

// --- GET /flood — rapid errors to test batching and buffer overflow ---
app.get('/flood', (c) => {
  const requestLogger = c.get('requestLogger')

  // Fire 50 error logs rapidly — with maxBufferSize=20, some will be dropped
  for (let i = 0; i < 50; i++) {
    requestLogger.error(`flood error ${i + 1}`, {
      error: new Error(`Batch error #${i + 1}`),
      index: i + 1,
      batch: 'flood-test',
    })
  }

  return c.json({
    message: 'Sent 50 error logs. Watch the terminal for onDropped callbacks and batched Sentry events.',
  })
})

// ============================================================================
// 4. Error handler
// ============================================================================

app.onError((err, c) => {
  return c.json({ error: err.message }, 500)
})

// ============================================================================
// 5. Start the server
// ============================================================================

const APP_PORT = 3008

export function startApp(): Promise<void> {
  return new Promise((resolve) => {
    serve({ fetch: app.fetch, port: APP_PORT }, () => {
      console.log(`\n  Hono + logscope + Sentry example on http://localhost:${APP_PORT}\n`)
      console.log('  Try these routes:')
      console.log(`    curl http://localhost:${APP_PORT}/`)
      console.log(`    curl http://localhost:${APP_PORT}/users/42          ${'\x1b[2m'}# info only — no Sentry${'\x1b[22m'}`)
      console.log(`    curl http://localhost:${APP_PORT}/error             ${'\x1b[2m'}# throws → Sentry event${'\x1b[22m'}`)
      console.log(`    curl http://localhost:${APP_PORT}/error/cause       ${'\x1b[2m'}# error cause chain${'\x1b[22m'}`)
      console.log(`    curl http://localhost:${APP_PORT}/error/explicit    ${'\x1b[2m'}# explicit error log${'\x1b[22m'}`)
      console.log(`    curl http://localhost:${APP_PORT}/warn              ${'\x1b[2m'}# warning — no Sentry${'\x1b[22m'}`)
      console.log(`    curl http://localhost:${APP_PORT}/slow              ${'\x1b[2m'}# slow — no Sentry${'\x1b[22m'}`)
      console.log(`    curl http://localhost:${APP_PORT}/flood             ${'\x1b[2m'}# overflow demo${'\x1b[22m'}`)
      console.log('')
      resolve()
    })
  })
}

// Graceful shutdown — flushes remaining Sentry batches
export async function shutdown(): Promise<void> {
  console.log('\nShutting down — flushing remaining Sentry batches...')
  await dispose()
  process.exit(0)
}
