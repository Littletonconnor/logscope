import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import { Hono } from 'hono'
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

/** Makes a Request for Hono's test client */
function req(path: string, method = 'GET'): Request {
  return new Request(`http://localhost${path}`, { method })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('@logscope/hono middleware', () => {
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
    const app = new Hono()
    const log = createLogger('app')
    app.use(logscope({ logger: log }))
    app.get('/hello', (c) => c.text('world'))

    await app.request(req('/hello'))

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
  })

  it('includes requestId in the scope context', async () => {
    const app = new Hono()
    const log = createLogger('app')
    app.use(
      logscope({
        logger: log,
        generateRequestId: () => 'req_123',
      }),
    )
    app.get('/test', (c) => c.text('ok'))

    await app.request(req('/test'))

    const record = collector.records[0]
    assert.strictEqual(record.properties.requestId, 'req_123')
  })

  it('handlers can access scope via c.get("scope")', async () => {
    const app = new Hono()
    const log = createLogger('app')
    app.use(logscope({ logger: log }))
    app.get('/users/:id', (c) => {
      const scope = c.get('scope')
      scope.set({ user: { id: c.req.param('id'), plan: 'premium' } })
      return c.json({ name: 'Alice' })
    })

    await app.request(req('/users/42'))

    const record = collector.records[0]
    const user = record.properties.user as Record<string, unknown>
    assert.strictEqual(user.id, '42')
    assert.strictEqual(user.plan, 'premium')
  })

  it('handlers can access requestLogger via c.get("requestLogger")', async () => {
    const app = new Hono()
    const log = createLogger('app')
    app.use(
      logscope({
        logger: log,
        generateRequestId: () => 'req_abc',
      }),
    )
    app.get('/test', (c) => {
      const reqLog = c.get('requestLogger')
      reqLog.info('handler log', { extra: true })
      return c.text('ok')
    })

    await app.request(req('/test'))

    // Should have 2 records: the handler's info log + the scope emit
    assert.strictEqual(collector.records.length, 2)

    // Handler log has requestId from .with()
    const handlerRecord = collector.records[0]
    assert.strictEqual(handlerRecord.properties.requestId, 'req_abc')
    assert.strictEqual(handlerRecord.properties.extra, true)
    assert.strictEqual(handlerRecord.rawMessage, 'handler log')
  })

  it('records errors thrown by handlers on the scope', async () => {
    const app = new Hono()
    const log = createLogger('app')
    app.use(logscope({ logger: log }))
    app.get('/fail', () => {
      throw new Error('something broke')
    })

    // Hono catches the error internally, but the middleware still records it
    await app.request(req('/fail'))

    const record = collector.records[0]
    assert.strictEqual(record.level, 'error')
    const error = record.properties.error as Record<string, unknown>
    assert.strictEqual(error.message, 'something broke')
    assert.strictEqual(error.name, 'Error')
    assert.ok(typeof error.stack === 'string')
  })

  it('supports custom getRequestContext', async () => {
    const app = new Hono()
    const log = createLogger('app')
    app.use(
      logscope({
        logger: log,
        getRequestContext: (c) => ({
          method: c.req.method,
          path: new URL(c.req.url).pathname,
          userAgent: c.req.header('user-agent') ?? 'unknown',
        }),
      }),
    )
    app.get('/test', (c) => c.text('ok'))

    const request = new Request('http://localhost/test', {
      headers: { 'user-agent': 'test-agent/1.0' },
    })
    await app.request(request)

    const record = collector.records[0]
    assert.strictEqual(record.properties.userAgent, 'test-agent/1.0')
  })

  it('supports custom getResponseContext', async () => {
    const app = new Hono()
    const log = createLogger('app')
    app.use(
      logscope({
        logger: log,
        getResponseContext: (c) => ({
          response: {
            status: c.res.status,
            contentType: c.res.headers.get('content-type'),
          },
        }),
      }),
    )
    app.get('/test', (c) => c.json({ ok: true }))

    await app.request(req('/test'))

    const record = collector.records[0]
    const response = record.properties.response as Record<string, unknown>
    assert.strictEqual(response.status, 200)
    assert.ok(
      (response.contentType as string).includes('application/json'),
    )
  })

  it('handles POST requests with correct method', async () => {
    const app = new Hono()
    const log = createLogger('app')
    app.use(logscope({ logger: log }))
    app.post('/submit', (c) => c.json({ ok: true }))

    await app.request(req('/submit', 'POST'))

    const record = collector.records[0]
    assert.strictEqual(record.properties.method, 'POST')
  })

  it('scope.warn sets the emitted level to warning', async () => {
    const app = new Hono()
    const log = createLogger('app')
    app.use(logscope({ logger: log }))
    app.get('/slow', (c) => {
      const scope = c.get('scope')
      scope.warn('slow query', { queryMs: 1200 })
      return c.text('ok')
    })

    await app.request(req('/slow'))

    const record = collector.records[0]
    assert.strictEqual(record.level, 'warning')
  })

  it('generates no requestId when generateRequestId returns undefined', async () => {
    const app = new Hono()
    const log = createLogger('app')
    app.use(
      logscope({
        logger: log,
        generateRequestId: () => undefined,
      }),
    )
    app.get('/test', (c) => c.text('ok'))

    await app.request(req('/test'))

    const record = collector.records[0]
    assert.strictEqual(record.properties.requestId, undefined)
  })

  it('emits at info level for successful requests', async () => {
    const app = new Hono()
    const log = createLogger('app')
    app.use(logscope({ logger: log }))
    app.get('/ok', (c) => c.text('ok'))

    await app.request(req('/ok'))

    assert.strictEqual(collector.records[0].level, 'info')
  })

  it('uses the logger category from the provided logger', async () => {
    // Reconfigure to include a logger matching the child category
    await configure({
      sinks: { test: collector.sink },
      loggers: [{ category: 'my-app', sinks: ['test'], level: 'trace' }],
      reset: true,
    })

    const app = new Hono()
    const log = createLogger(['my-app', 'http'])
    app.use(logscope({ logger: log }))
    app.get('/test', (c) => c.text('ok'))

    await app.request(req('/test'))

    assert.deepStrictEqual(collector.records[0].category, [
      'my-app',
      'http',
    ])
  })
})
