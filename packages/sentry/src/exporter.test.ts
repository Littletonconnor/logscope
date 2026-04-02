import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert'
import { configure, reset, createLogger } from 'logscope'
import { createSentrySink } from './exporter.ts'

const TEST_DSN = 'https://abc123@o0.ingest.sentry.io/12345'

describe('createSentrySink', () => {
  afterEach(async () => {
    await reset()
  })

  it('sends records to the Sentry envelope endpoint', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = []

    const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      requests.push({ url: url as string, init: init! })
      return new Response('', { status: 200 })
    }

    const sink = createSentrySink({
      dsn: TEST_DSN,
      fetch: mockFetch as typeof globalThis.fetch,
      batch: { size: 1, intervalMs: 100 },
    })

    await configure({
      sinks: { sentry: sink },
      loggers: [{ category: 'test', sinks: ['sentry'], level: 'info' }],
      reset: true,
    })

    const log = createLogger('test')
    log.info('hello from sentry', { userId: '123' })

    await sink.flush()

    assert.strictEqual(requests.length, 1)
    assert.strictEqual(
      requests[0].url,
      'https://o0.ingest.sentry.io/api/12345/envelope/',
    )

    const headers = requests[0].init.headers as Record<string, string>
    assert.strictEqual(headers['Content-Type'], 'application/x-sentry-envelope')
    assert.ok(headers['X-Sentry-Auth'].includes('sentry_key=abc123'))
    assert.ok(headers['X-Sentry-Auth'].includes('sentry_version=7'))

    // Parse the envelope body
    const body = requests[0].init.body as string
    const lines = body.split('\n')
    assert.strictEqual(lines.length, 3)

    const envelopeHeader = JSON.parse(lines[0])
    assert.strictEqual(envelopeHeader.dsn, TEST_DSN)

    const payload = JSON.parse(lines[2])
    assert.strictEqual(payload.level, 'info')
    assert.strictEqual(payload.logger, 'test')
    assert.strictEqual(payload.extra.userId, '123')
  })

  it('attaches environment and release as tags', async () => {
    const requests: Array<{ init: RequestInit }> = []

    const mockFetch = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      requests.push({ init: init! })
      return new Response('', { status: 200 })
    }

    const sink = createSentrySink({
      dsn: TEST_DSN,
      environment: 'production',
      release: '1.2.3',
      fetch: mockFetch as typeof globalThis.fetch,
      batch: { size: 1 },
    })

    await configure({
      sinks: { sentry: sink },
      loggers: [{ category: 'test', sinks: ['sentry'], level: 'info' }],
      reset: true,
    })

    createLogger('test').info('tagged event')
    await sink.flush()

    const body = requests[0].init.body as string
    const payload = JSON.parse(body.split('\n')[2])
    assert.strictEqual(payload.tags.environment, 'production')
    assert.strictEqual(payload.tags.release, '1.2.3')
  })

  it('sends custom headers', async () => {
    const requests: Array<{ init: RequestInit }> = []

    const mockFetch = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      requests.push({ init: init! })
      return new Response('', { status: 200 })
    }

    const sink = createSentrySink({
      dsn: TEST_DSN,
      headers: { 'X-Custom': 'value' },
      fetch: mockFetch as typeof globalThis.fetch,
      batch: { size: 1 },
    })

    await configure({
      sinks: { sentry: sink },
      loggers: [{ category: 'test', sinks: ['sentry'], level: 'info' }],
      reset: true,
    })

    createLogger('test').info('test')
    await sink.flush()

    const headers = requests[0].init.headers as Record<string, string>
    assert.strictEqual(headers['X-Custom'], 'value')
    assert.ok(headers['X-Sentry-Auth'])
  })

  it('retries on HTTP failure and calls onDropped after all retries fail', async () => {
    let attempts = 0
    const droppedBatches: unknown[] = []

    const mockFetch = async (): Promise<Response> => {
      attempts++
      return new Response('server error', { status: 500, statusText: 'Internal Server Error' })
    }

    const sink = createSentrySink({
      dsn: TEST_DSN,
      fetch: mockFetch as typeof globalThis.fetch,
      batch: { size: 1 },
      maxAttempts: 3,
      backoff: 'fixed',
      baseDelayMs: 10,
      onDropped: (batch, error) => {
        droppedBatches.push({ batch, error })
      },
    })

    await configure({
      sinks: { sentry: sink },
      loggers: [{ category: 'test', sinks: ['sentry'], level: 'info' }],
      reset: true,
    })

    createLogger('test').info('will fail')
    await sink.flush()

    assert.strictEqual(attempts, 3)
    assert.strictEqual(droppedBatches.length, 1)
  })

  it('supports Symbol.asyncDispose', () => {
    const mockFetch = async (): Promise<Response> => new Response('', { status: 200 })

    const sink = createSentrySink({
      dsn: TEST_DSN,
      fetch: mockFetch as typeof globalThis.fetch,
    })

    assert.strictEqual(typeof sink[Symbol.asyncDispose], 'function')
  })

  it('batches multiple records together', async () => {
    const requests: Array<{ body: string }> = []

    const mockFetch = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      requests.push({ body: init?.body as string })
      return new Response('', { status: 200 })
    }

    const sink = createSentrySink({
      dsn: TEST_DSN,
      fetch: mockFetch as typeof globalThis.fetch,
      batch: { size: 3, intervalMs: 50 },
    })

    await configure({
      sinks: { sentry: sink },
      loggers: [{ category: 'test', sinks: ['sentry'], level: 'info' }],
      reset: true,
    })

    const log = createLogger('test')
    log.info('one')
    log.info('two')
    log.info('three')

    await sink.flush()

    assert.strictEqual(requests.length, 1)
    // 3 events × 3 lines each = 9 lines total
    const lines = requests[0].body.split('\n')
    assert.strictEqual(lines.length, 9)
  })

  it('sends error records with exception interface', async () => {
    const requests: Array<{ body: string }> = []

    const mockFetch = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      requests.push({ body: init?.body as string })
      return new Response('', { status: 200 })
    }

    const sink = createSentrySink({
      dsn: TEST_DSN,
      fetch: mockFetch as typeof globalThis.fetch,
      batch: { size: 1 },
    })

    await configure({
      sinks: { sentry: sink },
      loggers: [{ category: 'test', sinks: ['sentry'], level: 'error' }],
      reset: true,
    })

    const err = new Error('kaboom')
    createLogger('test').error('request failed', { error: err, requestId: 'req_1' })
    await sink.flush()

    const payload = JSON.parse(requests[0].body.split('\n')[2])
    assert.strictEqual(payload.level, 'error')
    assert.ok(payload.exception)
    assert.strictEqual(payload.exception.values[0].type, 'Error')
    assert.strictEqual(payload.exception.values[0].value, 'kaboom')
    assert.strictEqual(payload.extra.requestId, 'req_1')
    // Error itself should not be in extra
    assert.strictEqual(payload.extra.error, undefined)
  })
})
