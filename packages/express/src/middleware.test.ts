import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import express from 'express'
import http from 'node:http'
import {
  createLogger,
  configure,
  reset,
  type Sink,
  type LogRecord,
} from 'logscope'
import { logscope } from './middleware.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collects all LogRecords emitted to a sink */
function createCollector(): { sink: Sink; records: LogRecord[] } {
  const records: LogRecord[] = []
  const sink: Sink = (record) => records.push(record)
  return { sink, records }
}

/** Start an Express app on a random port, return base URL and close function */
function listen(
  app: express.Express,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer(app)
    server.listen(0, () => {
      const addr = server.address() as { port: number }
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise<void>((r) => server.close(() => r())),
      })
    })
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('@logscope/express middleware', () => {
  let collector: ReturnType<typeof createCollector>

  beforeEach(async () => {
    collector = createCollector()
    await configure({
      sinks: { test: collector.sink },
      loggers: [{ category: 'app', sinks: ['test'], level: 'trace' }],
      reset: true,
    })
  })

  afterEach(() => {
    reset()
  })

  it('emits a single wide event per request', async () => {
    const app = express()
    const log = createLogger('app')
    app.use(logscope({ logger: log }))
    app.get('/hello', (_req, res) => {
      res.send('world')
    })

    const { baseUrl, close } = await listen(app)
    try {
      await fetch(`${baseUrl}/hello`)

      assert.strictEqual(collector.records.length, 1)
      const record = collector.records[0]
      assert.strictEqual(record.level, 'info')
      assert.strictEqual(record.properties.method, 'GET')
      assert.strictEqual(record.properties.path, '/hello')
      assert.strictEqual(
        (record.properties.response as Record<string, unknown>).status,
        200,
      )
      assert.strictEqual(typeof record.properties.duration, 'number')
    } finally {
      await close()
    }
  })

  it('includes requestId in the scope context', async () => {
    const app = express()
    const log = createLogger('app')
    app.use(
      logscope({
        logger: log,
        generateRequestId: () => 'req_123',
      }),
    )
    app.get('/test', (_req, res) => {
      res.send('ok')
    })

    const { baseUrl, close } = await listen(app)
    try {
      await fetch(`${baseUrl}/test`)
      const record = collector.records[0]
      assert.strictEqual(record.properties.requestId, 'req_123')
    } finally {
      await close()
    }
  })

  it('handlers can access scope via req.scope', async () => {
    const app = express()
    const log = createLogger('app')
    app.use(logscope({ logger: log }))
    app.get('/users/:id', (req, res) => {
      req.scope!.set({ user: { id: req.params.id, plan: 'premium' } })
      res.json({ name: 'Alice' })
    })

    const { baseUrl, close } = await listen(app)
    try {
      await fetch(`${baseUrl}/users/42`)

      const record = collector.records[0]
      const user = record.properties.user as Record<string, unknown>
      assert.strictEqual(user.id, '42')
      assert.strictEqual(user.plan, 'premium')
    } finally {
      await close()
    }
  })

  it('handlers can access requestLogger via req.requestLogger', async () => {
    const app = express()
    const log = createLogger('app')
    app.use(
      logscope({
        logger: log,
        generateRequestId: () => 'req_abc',
      }),
    )
    app.get('/test', (req, res) => {
      req.requestLogger!.info('handler log', { extra: true })
      res.send('ok')
    })

    const { baseUrl, close } = await listen(app)
    try {
      await fetch(`${baseUrl}/test`)

      // Should have 2 records: the handler's info log + the scope emit
      assert.strictEqual(collector.records.length, 2)

      // Handler log has requestId from .with()
      const handlerRecord = collector.records[0]
      assert.strictEqual(handlerRecord.properties.requestId, 'req_abc')
      assert.strictEqual(handlerRecord.properties.extra, true)
      assert.strictEqual(handlerRecord.rawMessage, 'handler log')
    } finally {
      await close()
    }
  })

  it('records errors passed to next() on the scope', async () => {
    const app = express()
    const log = createLogger('app')
    app.use(logscope({ logger: log }))
    app.get('/fail', (_req, _res, next) => {
      next(new Error('something broke'))
    })
    // Error handler to prevent Express from logging to stderr
    app.use(
      (
        _err: Error,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        res.status(500).send('Internal Server Error')
      },
    )

    const { baseUrl, close } = await listen(app)
    try {
      await fetch(`${baseUrl}/fail`)

      // The scope emits on 'finish', which fires after the error handler sends
      const record = collector.records[0]
      assert.strictEqual(record.level, 'info')
      assert.strictEqual(
        (record.properties.response as Record<string, unknown>).status,
        500,
      )
    } finally {
      await close()
    }
  })

  it('supports custom getRequestContext', async () => {
    const app = express()
    const log = createLogger('app')
    app.use(
      logscope({
        logger: log,
        getRequestContext: (req) => ({
          method: req.method,
          path: req.path,
          userAgent: req.get('user-agent') ?? 'unknown',
        }),
      }),
    )
    app.get('/test', (_req, res) => {
      res.send('ok')
    })

    const { baseUrl, close } = await listen(app)
    try {
      await fetch(`${baseUrl}/test`, {
        headers: { 'user-agent': 'test-agent/1.0' },
      })

      const record = collector.records[0]
      assert.strictEqual(record.properties.userAgent, 'test-agent/1.0')
    } finally {
      await close()
    }
  })

  it('supports custom getResponseContext', async () => {
    const app = express()
    const log = createLogger('app')
    app.use(
      logscope({
        logger: log,
        getResponseContext: (_req, res) => ({
          response: {
            status: res.statusCode,
            contentType: res.getHeader('content-type'),
          },
        }),
      }),
    )
    app.get('/test', (_req, res) => {
      res.json({ ok: true })
    })

    const { baseUrl, close } = await listen(app)
    try {
      await fetch(`${baseUrl}/test`)

      const record = collector.records[0]
      const response = record.properties.response as Record<string, unknown>
      assert.strictEqual(response.status, 200)
      assert.ok(
        (response.contentType as string).includes('application/json'),
      )
    } finally {
      await close()
    }
  })

  it('handles POST requests with correct method', async () => {
    const app = express()
    const log = createLogger('app')
    app.use(logscope({ logger: log }))
    app.post('/submit', (_req, res) => {
      res.json({ ok: true })
    })

    const { baseUrl, close } = await listen(app)
    try {
      await fetch(`${baseUrl}/submit`, { method: 'POST' })

      const record = collector.records[0]
      assert.strictEqual(record.properties.method, 'POST')
    } finally {
      await close()
    }
  })

  it('scope.warn sets the emitted level to warning', async () => {
    const app = express()
    const log = createLogger('app')
    app.use(logscope({ logger: log }))
    app.get('/slow', (req, res) => {
      req.scope!.warn('slow query', { queryMs: 1200 })
      res.send('ok')
    })

    const { baseUrl, close } = await listen(app)
    try {
      await fetch(`${baseUrl}/slow`)

      const record = collector.records[0]
      assert.strictEqual(record.level, 'warning')
    } finally {
      await close()
    }
  })

  it('generates no requestId when generateRequestId returns undefined', async () => {
    const app = express()
    const log = createLogger('app')
    app.use(
      logscope({
        logger: log,
        generateRequestId: () => undefined,
      }),
    )
    app.get('/test', (_req, res) => {
      res.send('ok')
    })

    const { baseUrl, close } = await listen(app)
    try {
      await fetch(`${baseUrl}/test`)

      const record = collector.records[0]
      assert.strictEqual(record.properties.requestId, undefined)
    } finally {
      await close()
    }
  })

  it('emits at info level for successful requests', async () => {
    const app = express()
    const log = createLogger('app')
    app.use(logscope({ logger: log }))
    app.get('/ok', (_req, res) => {
      res.send('ok')
    })

    const { baseUrl, close } = await listen(app)
    try {
      await fetch(`${baseUrl}/ok`)

      assert.strictEqual(collector.records[0].level, 'info')
    } finally {
      await close()
    }
  })

  it('uses the logger category from the provided logger', async () => {
    await configure({
      sinks: { test: collector.sink },
      loggers: [{ category: 'my-app', sinks: ['test'], level: 'trace' }],
      reset: true,
    })

    const app = express()
    const log = createLogger(['my-app', 'http'])
    app.use(logscope({ logger: log }))
    app.get('/test', (_req, res) => {
      res.send('ok')
    })

    const { baseUrl, close } = await listen(app)
    try {
      await fetch(`${baseUrl}/test`)

      assert.deepStrictEqual(collector.records[0].category, [
        'my-app',
        'http',
      ])
    } finally {
      await close()
    }
  })
})
