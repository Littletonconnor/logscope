import { AsyncLocalStorage } from 'node:async_hooks'
import { setTimeout } from 'node:timers/promises'

import express from 'express'
import type { Request, Response, NextFunction } from 'express'
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
import { logscope } from '@logscope/express'

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
// 2. Create the Express app with logscope middleware
// ============================================================================

const app = express()

// Parse JSON request bodies
app.use(express.json())

// Apply logscope middleware globally — every request gets a scoped wide event
app.use(
  logscope({
    logger: log,
    // Custom request context extractor — add headers we care about
    getRequestContext: (req) => ({
      method: req.method,
      path: req.path,
      userAgent: req.get('user-agent') ?? 'unknown',
    }),
    // Custom response context extractor — include content-type
    getResponseContext: (_req, res) => ({
      response: {
        status: res.statusCode,
        contentType: res.getHeader('content-type') ?? 'unknown',
      },
    }),
  }),
)

// ============================================================================
// 3. Routes
// ============================================================================

// --- GET / — simple baseline route ---
app.get('/', (_req: Request, res: Response) => {
  res.json({ message: 'Welcome to the logscope Express example!' })
})

// --- GET /users/:id — adds user context to scope ---
app.get('/users/:id', (req: Request, res: Response) => {
  const { scope, requestLogger } = req
  const userId = req.params.id

  // Add user context to the wide event
  scope!.set({ user: { id: userId, source: 'url_param' } })

  // Use requestLogger for within-request structured logs (separate from the wide event)
  requestLogger!.info('fetching user from database', { userId })

  // Simulate a DB lookup
  const user = { id: userId, name: 'Alice', plan: 'premium' }

  requestLogger!.info('user found', { userId, plan: user.plan })
  scope!.set({ user: { name: user.name, plan: user.plan } })

  res.json(user)
})

// --- POST /users — parses body, adds to scope ---
app.post('/users', (req: Request, res: Response) => {
  const { scope, requestLogger } = req

  const body = req.body
  scope!.set({ body })

  requestLogger!.info('creating new user', { name: body.name })

  // Simulate user creation
  const created = { id: 'user_new_123', ...body }
  scope!.set({ createdUser: { id: created.id } })

  res.status(201).json(created)
})

// --- GET /slow — simulated latency, shows duration tracking ---
app.get('/slow', async (req: Request, res: Response) => {
  const { scope, requestLogger } = req

  requestLogger!.info('starting slow operation')
  scope!.set({ operation: 'heavy_computation' })

  // Simulate a slow operation (500ms)
  await setTimeout(500)

  requestLogger!.info('slow operation completed')
  scope!.set({ result: { rowsProcessed: 10_000 } })

  res.json({ status: 'done', rowsProcessed: 10_000 })
})

// --- GET /error — throws an error, caught by error-handling middleware ---
app.get('/error', (req: Request, _res: Response) => {
  const { scope } = req
  scope!.set({ action: 'dangerous_operation' })

  // This error is caught by the error-handling middleware below,
  // recorded on the scope, and the wide event emits at error level
  throw new Error('Something went terribly wrong!')
})

// --- GET /warn — returns 4xx with scope.warn() ---
app.get('/warn', (req: Request, res: Response) => {
  const { scope } = req

  scope!.warn('resource not found — returning 404')
  scope!.set({ lookup: { table: 'products', id: 'prod_999' } })

  res.status(404).json({ error: 'Product not found' })
})

// ============================================================================
// 4. Error-handling middleware — catches errors and records them on the scope
// ============================================================================

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  // Record the error on the scope so the wide event emits at error level
  if (req.scope) {
    req.scope.error(err)
  }

  res.status(500).json({ error: err.message })
})

// ============================================================================
// 5. Start the server
// ============================================================================

const port = 3002

app.listen(port, () => {
  console.log(`\n  Express + logscope example running on http://localhost:${port}\n`)
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
