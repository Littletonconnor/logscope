import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import { configure, reset, createLogger } from 'logscope'
import { createOtlpExporter } from './exporter.ts'
import type { ExportLogsServiceRequest } from './mapping.ts'

describe('createOtlpExporter', () => {
  afterEach(async () => {
    await reset()
  })

  it('sends records to the OTLP endpoint as JSON', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = []

    const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      requests.push({ url: url as string, init: init! })
      return new Response('', { status: 200 })
    }

    const exporter = createOtlpExporter({
      endpoint: 'http://localhost:4318/v1/logs',
      resource: { 'service.name': 'test-service' },
      fetch: mockFetch as typeof globalThis.fetch,
      // Flush immediately: batch size 1
      batch: { size: 1, intervalMs: 100 },
    })

    await configure({
      sinks: { otlp: exporter },
      loggers: [{ category: 'test', sinks: ['otlp'], level: 'info' }],
      reset: true,
    })

    const log = createLogger('test')
    log.info('hello from otlp', { userId: '123' })

    // Flush to ensure the batch is sent
    await exporter.flush()

    assert.strictEqual(requests.length, 1)
    assert.strictEqual(requests[0].url, 'http://localhost:4318/v1/logs')
    assert.strictEqual((requests[0].init.headers as Record<string, string>)['Content-Type'], 'application/json')

    const payload: ExportLogsServiceRequest = JSON.parse(requests[0].init.body as string)
    assert.strictEqual(payload.resourceLogs.length, 1)

    const resourceAttrs = payload.resourceLogs[0].resource.attributes
    const serviceName = resourceAttrs.find((a) => a.key === 'service.name')
    assert.deepStrictEqual(serviceName?.value, { stringValue: 'test-service' })

    const logRecords = payload.resourceLogs[0].scopeLogs[0].logRecords
    assert.strictEqual(logRecords.length, 1)
    assert.strictEqual(logRecords[0].severityText, 'INFO')
  })

  it('sends custom headers', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = []

    const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      requests.push({ url: url as string, init: init! })
      return new Response('', { status: 200 })
    }

    const exporter = createOtlpExporter({
      headers: { Authorization: 'Bearer my-token', 'X-Custom': 'value' },
      fetch: mockFetch as typeof globalThis.fetch,
      batch: { size: 1 },
    })

    await configure({
      sinks: { otlp: exporter },
      loggers: [{ category: 'test', sinks: ['otlp'], level: 'info' }],
      reset: true,
    })

    createLogger('test').info('test')
    await exporter.flush()

    const headers = requests[0].init.headers as Record<string, string>
    assert.strictEqual(headers['Authorization'], 'Bearer my-token')
    assert.strictEqual(headers['X-Custom'], 'value')
  })

  it('retries on HTTP failure and calls onDropped after all retries fail', async () => {
    let attempts = 0
    const droppedBatches: unknown[] = []

    const mockFetch = async (): Promise<Response> => {
      attempts++
      return new Response('server error', { status: 500, statusText: 'Internal Server Error' })
    }

    const exporter = createOtlpExporter({
      fetch: mockFetch as typeof globalThis.fetch,
      batch: { size: 1 },
      maxAttempts: 3,
      backoff: 'fixed',
      baseDelayMs: 10, // Fast retries for testing
      onDropped: (batch, error) => {
        droppedBatches.push({ batch, error })
      },
    })

    await configure({
      sinks: { otlp: exporter },
      loggers: [{ category: 'test', sinks: ['otlp'], level: 'info' }],
      reset: true,
    })

    createLogger('test').info('will fail')
    await exporter.flush()

    assert.strictEqual(attempts, 3) // initial + 2 retries
    assert.strictEqual(droppedBatches.length, 1)
  })

  it('uses default endpoint when none specified', async () => {
    const requests: Array<{ url: string }> = []

    const mockFetch = async (url: string | URL | Request): Promise<Response> => {
      requests.push({ url: url as string })
      return new Response('', { status: 200 })
    }

    const exporter = createOtlpExporter({
      fetch: mockFetch as typeof globalThis.fetch,
      batch: { size: 1 },
    })

    await configure({
      sinks: { otlp: exporter },
      loggers: [{ category: 'test', sinks: ['otlp'], level: 'info' }],
      reset: true,
    })

    createLogger('test').info('default endpoint')
    await exporter.flush()

    assert.strictEqual(requests[0].url, 'http://localhost:4318/v1/logs')
  })

  it('supports Symbol.asyncDispose', async () => {
    const mockFetch = async (): Promise<Response> => new Response('', { status: 200 })

    const exporter = createOtlpExporter({
      fetch: mockFetch as typeof globalThis.fetch,
    })

    assert.strictEqual(typeof exporter[Symbol.asyncDispose], 'function')
  })

  it('batches multiple records together', async () => {
    const requests: Array<{ body: string }> = []

    const mockFetch = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      requests.push({ body: init?.body as string })
      return new Response('', { status: 200 })
    }

    const exporter = createOtlpExporter({
      fetch: mockFetch as typeof globalThis.fetch,
      batch: { size: 3, intervalMs: 50 },
    })

    await configure({
      sinks: { otlp: exporter },
      loggers: [{ category: 'test', sinks: ['otlp'], level: 'info' }],
      reset: true,
    })

    const log = createLogger('test')
    log.info('one')
    log.info('two')
    log.info('three')

    // Wait for batch size to trigger
    await exporter.flush()

    // All three should be in one batch
    assert.strictEqual(requests.length, 1)
    const payload: ExportLogsServiceRequest = JSON.parse(requests[0].body)
    assert.strictEqual(payload.resourceLogs[0].scopeLogs[0].logRecords.length, 3)
  })
})
