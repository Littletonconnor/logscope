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
  getJsonFormatter,
  withFilter,
  getLevelFilter,
} from 'logscope'
import { logscope } from '@logscope/hono'
import type { LogscopeVariables } from '@logscope/hono'

// ============================================================================
// 1. Configure logscope
// ============================================================================

const log = createLogger('my-app')

await configure({
  sinks: {
    console: getConsoleSink({ formatter: getAnsiColorFormatter() }),
    json: withFilter(
      getConsoleSink({ formatter: getJsonFormatter() }),
      getLevelFilter('warning'),
    ),
  },
  loggers: [
    { category: 'my-app', level: 'debug', sinks: ['console', 'json'] },
  ],
  contextLocalStorage: new AsyncLocalStorage<Record<string, unknown>>(),
})

// ============================================================================
// 2. Create the Hono app with logscope middleware
// ============================================================================

const app = new Hono<{ Variables: LogscopeVariables }>()

// Apply logscope middleware globally — every request gets a scoped wide event
app.use(
  logscope({
    logger: log,
    // Custom request context extractor — add headers we care about
    getRequestContext: (c) => {
      const url = new URL(c.req.url)
      return {
        method: c.req.method,
        path: url.pathname,
        userAgent: c.req.header('user-agent') ?? 'unknown',
      }
    },
    // Custom response context extractor — include content-type
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

// --- GET / — simple baseline route ---
app.get('/', (c) => {
  return c.json({ message: 'Welcome to the logscope Hono example!' })
})

// --- GET /users/:id — adds user context to scope ---
app.get('/users/:id', (c) => {
  const scope = c.get('scope')
  const requestLogger = c.get('requestLogger')
  const userId = c.req.param('id')

  // Add user context to the wide event
  scope.set({ user: { id: userId, source: 'url_param' } })

  // Use requestLogger for within-request structured logs (separate from the wide event)
  requestLogger.info('fetching user from database', { userId })

  // Simulate a DB lookup
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

  // Simulate user creation
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

  // Simulate a slow operation (500ms)
  await setTimeout(500)

  requestLogger.info('slow operation completed')
  scope.set({ result: { rowsProcessed: 10_000 } })

  return c.json({ status: 'done', rowsProcessed: 10_000 })
})

// --- GET /error — throws an error, scope emits at error level ---
app.get('/error', (c) => {
  const scope = c.get('scope')
  scope.set({ action: 'dangerous_operation' })

  // This error is caught by the middleware, recorded on the scope,
  // and the wide event emits at error level
  throw new Error('Something went terribly wrong!')
})

// --- GET /warn — returns 4xx with scope.warn() ---
app.get('/warn', (c) => {
  const scope = c.get('scope')

  scope.warn('resource not found — returning 404')
  scope.set({ lookup: { table: 'products', id: 'prod_999' } })

  return c.json({ error: 'Product not found' }, 404)
})

// ============================================================================
// 4. Error handler — returns JSON error response
// ============================================================================

app.onError((err, c) => {
  return c.json({ error: err.message }, 500)
})

// ============================================================================
// 5. Start the server
// ============================================================================

const port = 3001

serve({ fetch: app.fetch, port }, () => {
  console.log(`\n  Hono + logscope example running on http://localhost:${port}\n`)
  console.log('  Try these routes:')
  console.log(`    curl http://localhost:${port}/`)
  console.log(`    curl http://localhost:${port}/users/42`)
  console.log(
    `    curl -X POST http://localhost:${port}/users -H 'Content-Type: application/json' -d '{"name":"Alice","email":"alice@example.com"}'`,
  )
  console.log(`    curl http://localhost:${port}/slow`)
  console.log(`    curl http://localhost:${port}/error`)
  console.log(`    curl http://localhost:${port}/warn`)
  console.log('')
})

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...')
  await dispose()
  process.exit(0)
})
