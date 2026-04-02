import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
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

/**
 * Minimal mock of NitroApp's hook system.
 * Stores registered hooks and provides a `call` method to trigger them.
 */
function createMockNitroApp() {
  const hooks: Record<string, ((...args: unknown[]) => void)[]> = {}
  return {
    hooks: {
      hook(name: string, handler: (...args: unknown[]) => void) {
        if (!hooks[name]) hooks[name] = []
        hooks[name].push(handler)
      },
    },
    /** Fire all handlers registered for a hook */
    async call(name: string, ...args: unknown[]) {
      for (const handler of hooks[name] ?? []) {
        handler(...args)
      }
    },
  }
}

/**
 * Creates a minimal mock H3Event with the properties our middleware uses.
 * h3's getMethod/getRequestURL/getResponseStatus read from the event's
 * internal properties, so we mock the underlying node req/res.
 */
function createMockEvent(
  path: string,
  method = 'GET',
  statusCode = 200,
): {
  method: string
  path: string
  headers: Headers
  context: Record<string, unknown>
  node: { req: { method: string; url: string; headers: Record<string, string> }; res: { statusCode: number } }
  _method?: string
  _path?: string
} {
  return {
    method,
    path,
    headers: new Headers(),
    context: {},
    node: {
      req: {
        method,
        url: `http://localhost${path}`,
        headers: {},
      },
      res: { statusCode },
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('@logscope/nitro plugin', () => {
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
    const app = createMockNitroApp()
    const log = createLogger('app')
    logscope({ logger: log })(app)

    const event = createMockEvent('/hello')
    await app.call('request', event)
    await app.call('afterResponse', event)

    assert.strictEqual(collector.records.length, 1)
    const record = collector.records[0]
    assert.strictEqual(record.level, 'info')
    assert.strictEqual(record.properties.method, 'GET')
    assert.strictEqual(record.properties.path, '/hello')
    assert.strictEqual(typeof record.properties.duration, 'number')
  })

  it('includes response status in emitted context', async () => {
    const app = createMockNitroApp()
    const log = createLogger('app')
    logscope({ logger: log })(app)

    const event = createMockEvent('/test', 'GET', 201)
    await app.call('request', event)
    await app.call('afterResponse', event)

    const record = collector.records[0]
    const response = record.properties.response as Record<string, unknown>
    assert.strictEqual(response.status, 201)
  })

  it('includes requestId in the scope context', async () => {
    const app = createMockNitroApp()
    const log = createLogger('app')
    logscope({
      logger: log,
      generateRequestId: () => 'req_123',
    })(app)

    const event = createMockEvent('/test')
    await app.call('request', event)
    await app.call('afterResponse', event)

    const record = collector.records[0]
    assert.strictEqual(record.properties.requestId, 'req_123')
  })

  it('attaches logscope context to event.context', async () => {
    const app = createMockNitroApp()
    const log = createLogger('app')
    logscope({
      logger: log,
      generateRequestId: () => 'req_abc',
    })(app)

    const event = createMockEvent('/test')
    await app.call('request', event)

    const ctx = event.context.logscope as {
      scope: unknown
      requestLogger: unknown
      requestId: string | undefined
    }
    assert.ok(ctx, 'event.context.logscope should be set')
    assert.strictEqual(ctx.requestId, 'req_abc')
    assert.ok(ctx.scope, 'scope should be set')
    assert.ok(ctx.requestLogger, 'requestLogger should be set')
  })

  it('handlers can set scope context via event.context.logscope', async () => {
    const app = createMockNitroApp()
    const log = createLogger('app')
    logscope({ logger: log })(app)

    const event = createMockEvent('/users/42')
    await app.call('request', event)

    // Simulate a handler setting context on the scope
    const ctx = event.context.logscope as {
      scope: { set: (data: Record<string, unknown>) => void }
    }
    ctx.scope.set({ user: { id: '42', plan: 'premium' } })

    await app.call('afterResponse', event)

    const record = collector.records[0]
    const user = record.properties.user as Record<string, unknown>
    assert.strictEqual(user.id, '42')
    assert.strictEqual(user.plan, 'premium')
  })

  it('records errors via the error hook', async () => {
    const app = createMockNitroApp()
    const log = createLogger('app')
    logscope({ logger: log })(app)

    const event = createMockEvent('/fail')
    await app.call('request', event)
    await app.call('error', new Error('something broke'), { event })
    await app.call('afterResponse', event)

    const record = collector.records[0]
    assert.strictEqual(record.level, 'error')
    const error = record.properties.error as Record<string, unknown>
    assert.strictEqual(error.message, 'something broke')
    assert.strictEqual(error.name, 'Error')
    assert.ok(typeof error.stack === 'string')
  })

  it('supports custom getRequestContext', async () => {
    const app = createMockNitroApp()
    const log = createLogger('app')
    logscope({
      logger: log,
      getRequestContext: (event) => ({
        method: event.method,
        path: event.path,
        custom: 'value',
      }),
    })(app)

    const event = createMockEvent('/test')
    await app.call('request', event)
    await app.call('afterResponse', event)

    const record = collector.records[0]
    assert.strictEqual(record.properties.custom, 'value')
  })

  it('supports custom getResponseContext', async () => {
    const app = createMockNitroApp()
    const log = createLogger('app')
    logscope({
      logger: log,
      getResponseContext: (event) => ({
        response: {
          status: event.node.res.statusCode,
          custom: true,
        },
      }),
    })(app)

    const event = createMockEvent('/test')
    await app.call('request', event)
    await app.call('afterResponse', event)

    const record = collector.records[0]
    const response = record.properties.response as Record<string, unknown>
    assert.strictEqual(response.custom, true)
  })

  it('handles POST requests with correct method', async () => {
    const app = createMockNitroApp()
    const log = createLogger('app')
    logscope({ logger: log })(app)

    const event = createMockEvent('/submit', 'POST')
    await app.call('request', event)
    await app.call('afterResponse', event)

    const record = collector.records[0]
    assert.strictEqual(record.properties.method, 'POST')
  })

  it('scope.warn sets the emitted level to warning', async () => {
    const app = createMockNitroApp()
    const log = createLogger('app')
    logscope({ logger: log })(app)

    const event = createMockEvent('/slow')
    await app.call('request', event)

    const ctx = event.context.logscope as {
      scope: { warn: (msg: string, ctx?: Record<string, unknown>) => void }
    }
    ctx.scope.warn('slow query', { queryMs: 1200 })

    await app.call('afterResponse', event)

    const record = collector.records[0]
    assert.strictEqual(record.level, 'warning')
  })

  it('generates no requestId when generateRequestId returns undefined', async () => {
    const app = createMockNitroApp()
    const log = createLogger('app')
    logscope({
      logger: log,
      generateRequestId: () => undefined,
    })(app)

    const event = createMockEvent('/test')
    await app.call('request', event)
    await app.call('afterResponse', event)

    const record = collector.records[0]
    assert.strictEqual(record.properties.requestId, undefined)
  })

  it('emits at info level for successful requests', async () => {
    const app = createMockNitroApp()
    const log = createLogger('app')
    logscope({ logger: log })(app)

    const event = createMockEvent('/ok')
    await app.call('request', event)
    await app.call('afterResponse', event)

    assert.strictEqual(collector.records[0].level, 'info')
  })

  it('uses the logger category from the provided logger', async () => {
    await configure({
      sinks: { test: collector.sink },
      loggers: [{ category: 'my-app', sinks: ['test'], level: 'trace' }],
      reset: true,
    })

    const app = createMockNitroApp()
    const log = createLogger(['my-app', 'http'])
    logscope({ logger: log })(app)

    const event = createMockEvent('/test')
    await app.call('request', event)
    await app.call('afterResponse', event)

    assert.deepStrictEqual(collector.records[0].category, [
      'my-app',
      'http',
    ])
  })

  it('handles afterResponse without prior request hook gracefully', async () => {
    const app = createMockNitroApp()
    const log = createLogger('app')
    logscope({ logger: log })(app)

    // Call afterResponse without request — should not throw
    const event = createMockEvent('/orphan')
    await app.call('afterResponse', event)

    assert.strictEqual(collector.records.length, 0)
  })

  it('handles error hook without logscope context gracefully', async () => {
    const app = createMockNitroApp()
    const log = createLogger('app')
    logscope({ logger: log })(app)

    // Call error hook on an event that was never seen by request hook
    const event = createMockEvent('/orphan')
    await app.call('error', new Error('orphan'), { event })

    assert.strictEqual(collector.records.length, 0)
  })
})
