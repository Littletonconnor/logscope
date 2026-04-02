import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert'
import { configure, reset, createLogger } from 'logscope'
import { createAxiomSink } from './exporter.ts'
import type { AxiomEvent } from './mapping.ts'

describe('createAxiomSink', () => {
  afterEach(async () => {
    await reset()
  })

  it('sends records to the Axiom ingest endpoint', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = []

    const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      requests.push({ url: url as string, init: init! })
      return new Response('', { status: 200 })
    }

    const sink = createAxiomSink({
      dataset: 'my-logs',
      token: 'xaat-test-token',
      fetch: mockFetch as typeof globalThis.fetch,
      batch: { size: 1, intervalMs: 100 },
    })

    await configure({
      sinks: { axiom: sink },
      loggers: [{ category: 'test', sinks: ['axiom'], level: 'info' }],
      reset: true,
    })

    const log = createLogger('test')
    log.info('hello from axiom', { userId: '123' })

    await sink.flush()

    assert.strictEqual(requests.length, 1)
    assert.strictEqual(requests[0].url, 'https://api.axiom.co/v1/datasets/my-logs/ingest')

    const headers = requests[0].init.headers as Record<string, string>
    assert.strictEqual(headers['Content-Type'], 'application/json')
    assert.strictEqual(headers['Authorization'], 'Bearer xaat-test-token')

    const events: AxiomEvent[] = JSON.parse(requests[0].init.body as string)
    assert.strictEqual(events.length, 1)
    assert.strictEqual(events[0].level, 'INFO')
    assert.strictEqual(events[0].logger, 'test')
    assert.strictEqual(events[0].userId, '123')
  })

  it('uses custom URL', async () => {
    const requests: Array<{ url: string }> = []

    const mockFetch = async (url: string | URL | Request): Promise<Response> => {
      requests.push({ url: url as string })
      return new Response('', { status: 200 })
    }

    const sink = createAxiomSink({
      dataset: 'logs',
      token: 'token',
      url: 'https://cloud.axiom.co',
      fetch: mockFetch as typeof globalThis.fetch,
      batch: { size: 1 },
    })

    await configure({
      sinks: { axiom: sink },
      loggers: [{ category: 'test', sinks: ['axiom'], level: 'info' }],
      reset: true,
    })

    createLogger('test').info('test')
    await sink.flush()

    assert.strictEqual(requests[0].url, 'https://cloud.axiom.co/v1/datasets/logs/ingest')
  })

  it('sends custom headers', async () => {
    const requests: Array<{ init: RequestInit }> = []

    const mockFetch = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      requests.push({ init: init! })
      return new Response('', { status: 200 })
    }

    const sink = createAxiomSink({
      dataset: 'logs',
      token: 'token',
      headers: { 'X-Custom': 'value' },
      fetch: mockFetch as typeof globalThis.fetch,
      batch: { size: 1 },
    })

    await configure({
      sinks: { axiom: sink },
      loggers: [{ category: 'test', sinks: ['axiom'], level: 'info' }],
      reset: true,
    })

    createLogger('test').info('test')
    await sink.flush()

    const headers = requests[0].init.headers as Record<string, string>
    assert.strictEqual(headers['X-Custom'], 'value')
    assert.strictEqual(headers['Authorization'], 'Bearer token')
  })

  it('retries on HTTP failure and calls onDropped after all retries fail', async () => {
    let attempts = 0
    const droppedBatches: unknown[] = []

    const mockFetch = async (): Promise<Response> => {
      attempts++
      return new Response('server error', { status: 500, statusText: 'Internal Server Error' })
    }

    const sink = createAxiomSink({
      dataset: 'logs',
      token: 'token',
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
      sinks: { axiom: sink },
      loggers: [{ category: 'test', sinks: ['axiom'], level: 'info' }],
      reset: true,
    })

    createLogger('test').info('will fail')
    await sink.flush()

    assert.strictEqual(attempts, 3)
    assert.strictEqual(droppedBatches.length, 1)
  })

  it('supports Symbol.asyncDispose', () => {
    const mockFetch = async (): Promise<Response> => new Response('', { status: 200 })

    const sink = createAxiomSink({
      dataset: 'logs',
      token: 'token',
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

    const sink = createAxiomSink({
      dataset: 'logs',
      token: 'token',
      fetch: mockFetch as typeof globalThis.fetch,
      batch: { size: 3, intervalMs: 50 },
    })

    await configure({
      sinks: { axiom: sink },
      loggers: [{ category: 'test', sinks: ['axiom'], level: 'info' }],
      reset: true,
    })

    const log = createLogger('test')
    log.info('one')
    log.info('two')
    log.info('three')

    await sink.flush()

    assert.strictEqual(requests.length, 1)
    const events: AxiomEvent[] = JSON.parse(requests[0].body)
    assert.strictEqual(events.length, 3)
  })

  it('URL-encodes the dataset name', async () => {
    const requests: Array<{ url: string }> = []

    const mockFetch = async (url: string | URL | Request): Promise<Response> => {
      requests.push({ url: url as string })
      return new Response('', { status: 200 })
    }

    const sink = createAxiomSink({
      dataset: 'my app/logs',
      token: 'token',
      fetch: mockFetch as typeof globalThis.fetch,
      batch: { size: 1 },
    })

    await configure({
      sinks: { axiom: sink },
      loggers: [{ category: 'test', sinks: ['axiom'], level: 'info' }],
      reset: true,
    })

    createLogger('test').info('test')
    await sink.flush()

    assert.strictEqual(requests[0].url, 'https://api.axiom.co/v1/datasets/my%20app%2Flogs/ingest')
  })
})
