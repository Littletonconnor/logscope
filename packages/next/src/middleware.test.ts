import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import {
  createLogger,
  configure,
  reset,
  type Sink,
  type LogRecord,
} from 'logscope'
import { withLogscope, withLogscopeAction } from './middleware.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collects all LogRecords emitted to a sink */
function createCollector(): { sink: Sink; records: LogRecord[] } {
  const records: LogRecord[] = []
  const sink: Sink = (record) => records.push(record)
  return { sink, records }
}

/**
 * Creates a minimal NextRequest-compatible object for testing.
 * Real NextRequest extends Request and adds Next.js-specific properties.
 * For testing purposes, a standard Request with the same shape works.
 */
function createNextRequest(
  path: string,
  method = 'GET',
  headers?: Record<string, string>,
): Request {
  return new Request(`http://localhost${path}`, { method, headers })
}

/** Default route context with empty params */
function routeContext(
  params: Record<string, string | string[]> = {},
): { params: Promise<Record<string, string | string[]>> } {
  return { params: Promise.resolve(params) }
}

// ---------------------------------------------------------------------------
// withLogscope — Route Handler wrapper
// ---------------------------------------------------------------------------

describe('@logscope/next withLogscope', () => {
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
    const log = createLogger('app')
    const handler = withLogscope({ logger: log }, async (req, { logscope }) => {
      return Response.json({ ok: true })
    })

    const req = createNextRequest('/hello')
    await handler(req, routeContext())

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
    const log = createLogger('app')
    const handler = withLogscope(
      { logger: log, generateRequestId: () => 'req_123' },
      async () => Response.json({ ok: true }),
    )

    await handler(createNextRequest('/test'), routeContext())

    const record = collector.records[0]
    assert.strictEqual(record.properties.requestId, 'req_123')
  })

  it('provides scope to handlers via logscope context', async () => {
    const log = createLogger('app')
    const handler = withLogscope({ logger: log }, async (req, { params, logscope }) => {
      const { id } = await params
      logscope.scope.set({ user: { id, plan: 'premium' } })
      return Response.json({ name: 'Alice' })
    })

    await handler(createNextRequest('/users/42'), routeContext({ id: '42' }))

    const record = collector.records[0]
    const user = record.properties.user as Record<string, unknown>
    assert.strictEqual(user.id, '42')
    assert.strictEqual(user.plan, 'premium')
  })

  it('provides requestLogger with requestId via logscope context', async () => {
    const log = createLogger('app')
    const handler = withLogscope(
      { logger: log, generateRequestId: () => 'req_abc' },
      async (req, { logscope }) => {
        logscope.requestLogger.info('handler log', { extra: true })
        return new Response('ok')
      },
    )

    await handler(createNextRequest('/test'), routeContext())

    // Should have 2 records: the handler's info log + the scope emit
    assert.strictEqual(collector.records.length, 2)

    const handlerRecord = collector.records[0]
    assert.strictEqual(handlerRecord.properties.requestId, 'req_abc')
    assert.strictEqual(handlerRecord.properties.extra, true)
    assert.strictEqual(handlerRecord.rawMessage, 'handler log')
  })

  it('records errors thrown by handlers on the scope', async () => {
    const log = createLogger('app')
    const handler = withLogscope({ logger: log }, async () => {
      throw new Error('something broke')
    })

    await assert.rejects(
      () => handler(createNextRequest('/fail'), routeContext()),
      { message: 'something broke' },
    )

    const record = collector.records[0]
    assert.strictEqual(record.level, 'error')
    const error = record.properties.error as Record<string, unknown>
    assert.strictEqual(error.message, 'something broke')
    assert.strictEqual(error.name, 'Error')
    assert.ok(typeof error.stack === 'string')
  })

  it('supports custom getRequestContext', async () => {
    const log = createLogger('app')
    const handler = withLogscope(
      {
        logger: log,
        getRequestContext: (req) => ({
          method: req.method,
          path: new URL(req.url).pathname,
          userAgent: req.headers.get('user-agent') ?? 'unknown',
        }),
      },
      async () => new Response('ok'),
    )

    const req = createNextRequest('/test', 'GET', {
      'user-agent': 'test-agent/1.0',
    })
    await handler(req, routeContext())

    const record = collector.records[0]
    assert.strictEqual(record.properties.userAgent, 'test-agent/1.0')
  })

  it('supports custom getResponseContext', async () => {
    const log = createLogger('app')
    const handler = withLogscope(
      {
        logger: log,
        getResponseContext: (_req, res) => ({
          response: {
            status: res.status,
            contentType: res.headers.get('content-type'),
          },
        }),
      },
      async () => Response.json({ ok: true }),
    )

    await handler(createNextRequest('/test'), routeContext())

    const record = collector.records[0]
    const response = record.properties.response as Record<string, unknown>
    assert.strictEqual(response.status, 200)
    assert.ok(
      (response.contentType as string).includes('application/json'),
    )
  })

  it('handles POST requests with correct method', async () => {
    const log = createLogger('app')
    const handler = withLogscope(
      { logger: log },
      async () => Response.json({ ok: true }),
    )

    await handler(createNextRequest('/submit', 'POST'), routeContext())

    const record = collector.records[0]
    assert.strictEqual(record.properties.method, 'POST')
  })

  it('generates no requestId when generateRequestId returns undefined', async () => {
    const log = createLogger('app')
    const handler = withLogscope(
      { logger: log, generateRequestId: () => undefined },
      async () => new Response('ok'),
    )

    await handler(createNextRequest('/test'), routeContext())

    const record = collector.records[0]
    assert.strictEqual(record.properties.requestId, undefined)
  })

  it('uses the logger category from the provided logger', async () => {
    await configure({
      sinks: { test: collector.sink },
      loggers: [{ category: 'my-app', sinks: ['test'], level: 'trace' }],
      reset: true,
    })

    const log = createLogger(['my-app', 'api'])
    const handler = withLogscope(
      { logger: log },
      async () => new Response('ok'),
    )

    await handler(createNextRequest('/test'), routeContext())

    assert.deepStrictEqual(collector.records[0].category, ['my-app', 'api'])
  })
})

// ---------------------------------------------------------------------------
// withLogscopeAction — Server Action wrapper
// ---------------------------------------------------------------------------

describe('@logscope/next withLogscopeAction', () => {
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

  it('emits a single wide event per action invocation', async () => {
    const log = createLogger('app')
    const action = withLogscopeAction(
      { logger: log, actionName: 'submitForm' },
      async ({ scope }, data: { email: string }) => {
        scope.set({ user: { email: data.email } })
        return { success: true }
      },
    )

    const result = await action({ email: 'alice@example.com' })

    assert.deepStrictEqual(result, { success: true })
    assert.strictEqual(collector.records.length, 1)
    const record = collector.records[0]
    assert.strictEqual(record.level, 'info')
    assert.strictEqual(record.properties.action, 'submitForm')
    const user = record.properties.user as Record<string, unknown>
    assert.strictEqual(user.email, 'alice@example.com')
    assert.strictEqual(typeof record.properties.duration, 'number')
  })

  it('records errors thrown by actions on the scope', async () => {
    const log = createLogger('app')
    const action = withLogscopeAction(
      { logger: log, actionName: 'failAction' },
      async () => {
        throw new Error('action failed')
      },
    )

    await assert.rejects(() => action(), { message: 'action failed' })

    const record = collector.records[0]
    assert.strictEqual(record.level, 'error')
    const error = record.properties.error as Record<string, unknown>
    assert.strictEqual(error.message, 'action failed')
  })

  it('defaults actionName to "serverAction"', async () => {
    const log = createLogger('app')
    const action = withLogscopeAction(
      { logger: log },
      async ({ scope }) => {
        return 'done'
      },
    )

    await action()

    const record = collector.records[0]
    assert.strictEqual(record.properties.action, 'serverAction')
  })

  it('provides requestLogger with action context', async () => {
    const log = createLogger('app')
    const action = withLogscopeAction(
      { logger: log, actionName: 'myAction' },
      async ({ requestLogger }) => {
        requestLogger.info('inside action', { step: 1 })
        return 'done'
      },
    )

    await action()

    // Should have 2 records: the logger.info + the scope emit
    assert.strictEqual(collector.records.length, 2)
    const infoRecord = collector.records[0]
    assert.strictEqual(infoRecord.properties.action, 'myAction')
    assert.strictEqual(infoRecord.properties.step, 1)
  })

  it('returns the action result', async () => {
    const log = createLogger('app')
    const action = withLogscopeAction(
      { logger: log },
      async (_logscope, x: number, y: number) => x + y,
    )

    const result = await action(3, 4)
    assert.strictEqual(result, 7)
  })
})
