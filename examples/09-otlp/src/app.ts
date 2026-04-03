/**
 * Hono application with logscope + OTLP exporter.
 *
 * Logs go to two sinks in parallel:
 *   1. Console — colorful ANSI output in the terminal (immediate)
 *   2. OTLP   — batched export to the mock OTLP collector
 *
 * The OTLP exporter uses createOtlpExporter() which internally batches records,
 * retries on failure with exponential backoff, and drops records when the
 * buffer overflows (calling onDropped so you can monitor).
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
} from 'logscope'
import { createOtlpExporter } from '@logscope/otlp'
import { logscope } from '@logscope/hono'
import type { LogscopeVariables } from '@logscope/hono'

// ============================================================================
// 1. Configure logscope with console + OTLP sinks
// ============================================================================

const MOCK_COLLECTOR_PORT = 3107
const MOCK_COLLECTOR_URL = `http://localhost:${MOCK_COLLECTOR_PORT}/v1/logs`

const log = createLogger('my-app')

// Create the OTLP exporter pointed at our mock collector
const otlpSink = createOtlpExporter({
  endpoint: MOCK_COLLECTOR_URL,
  resource: {
    'service.name': 'example-otlp-app',
    'service.version': '1.0.0',
    'deployment.environment': 'development',
  },
  headers: {
    Authorization: 'Bearer otlp-example-token',
  },
  batch: {
    size: 5, // Small batch size so you see flushes frequently
    intervalMs: 3000, // Flush every 3 seconds even if batch isn't full
  },
  maxBufferSize: 20, // Small buffer to demonstrate overflow with /flood
  maxAttempts: 3,
  backoff: 'exponential',
  baseDelayMs: 500,
  onDropped: (batch, error) => {
    console.log(
      `\x1b[31m  [otlp-sink] Dropped ${batch.length} records: ${error}\x1b[39m`,
    )
  },
})

await configure({
  sinks: {
    console: getConsoleSink({ formatter: getAnsiColorFormatter() }),
    otlp: otlpSink,
  },
  loggers: [
    { category: 'my-app', level: 'debug', sinks: ['console', 'otlp'] },
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

// --- GET / — baseline route ---
app.get('/', (c) => {
  return c.json({ message: 'Welcome to the logscope OTLP example!' })
})

// --- GET /users/:id — adds user context to scope ---
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

// --- POST /users — parses body, adds to scope ---
app.post('/users', async (c) => {
  const scope = c.get('scope')
  const requestLogger = c.get('requestLogger')

  const body = await c.req.json()
  scope.set({ body })
  requestLogger.info('creating new user', { name: body.name })

  const created = { id: 'user_new_123', ...body }
  scope.set({ createdUser: { id: created.id } })

  return c.json(created, 201)
})

// --- GET /slow — simulated latency, shows duration tracking ---
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

// --- GET /error — throws, scope emits at error level ---
app.get('/error', (c) => {
  const scope = c.get('scope')
  scope.set({ action: 'dangerous_operation' })
  throw new Error('Something went terribly wrong!')
})

// --- GET /warn — returns 4xx with scope.warn() ---
app.get('/warn', (c) => {
  const scope = c.get('scope')
  scope.warn('resource not found — returning 404')
  scope.set({ lookup: { table: 'products', id: 'prod_999' } })
  return c.json({ error: 'Product not found' }, 404)
})

// --- GET /flood — generates many logs quickly to demonstrate buffer overflow ---
app.get('/flood', (c) => {
  const requestLogger = c.get('requestLogger')

  // Fire 50 logs rapidly — with maxBufferSize=20, some will be dropped
  for (let i = 0; i < 50; i++) {
    requestLogger.info(`flood message ${i + 1}`, {
      index: i + 1,
      batch: 'flood-test',
    })
  }

  return c.json({
    message: 'Sent 50 log messages. Watch the terminal for onDropped callbacks and batched OTLP events.',
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

const APP_PORT = 3007

export function startApp(): Promise<void> {
  return new Promise((resolve) => {
    serve({ fetch: app.fetch, port: APP_PORT }, () => {
      console.log(`\n  Hono + logscope + OTLP example on http://localhost:${APP_PORT}\n`)
      console.log('  Try these routes:')
      console.log(`    curl http://localhost:${APP_PORT}/`)
      console.log(`    curl http://localhost:${APP_PORT}/users/42`)
      console.log(
        `    curl -X POST http://localhost:${APP_PORT}/users -H 'Content-Type: application/json' -d '{"name":"Alice","email":"alice@example.com"}'`,
      )
      console.log(`    curl http://localhost:${APP_PORT}/slow`)
      console.log(`    curl http://localhost:${APP_PORT}/error`)
      console.log(`    curl http://localhost:${APP_PORT}/warn`)
      console.log(`    curl http://localhost:${APP_PORT}/flood    ${'\x1b[2m'}# overflow demo${'\x1b[22m'}`)
      console.log('')
      resolve()
    })
  })
}

// Graceful shutdown — flushes remaining OTLP batches
export async function shutdown(): Promise<void> {
  console.log('\nShutting down — flushing remaining OTLP batches...')
  await dispose()
  process.exit(0)
}
