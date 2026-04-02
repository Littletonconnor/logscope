import { describe, it, mock, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import { createBrowserDrain } from './browser.ts'
import type { LogRecord } from './record.ts'
import type { LogLevel } from './level.ts'
import type { Sink } from './sink.ts'

function makeRecord(level: LogLevel, overrides?: Partial<LogRecord>): LogRecord {
  return {
    category: ['test'],
    level,
    timestamp: Date.now(),
    message: ['test message'],
    rawMessage: 'test message',
    properties: {},
    ...overrides,
  }
}

// Minimal mock for fetch that resolves successfully
function createMockFetch() {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fn = mock.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: url as string, init: init! })
    return new Response(null, { status: 200 })
  })
  return { fn, calls }
}

describe('createBrowserDrain', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('batches records and sends via fetch with keepalive', async () => {
    const { fn: mockFetch, calls } = createMockFetch()
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch

    const drain = createBrowserDrain({
      endpoint: '/api/logs',
      batch: { size: 3, intervalMs: 60000 },
      flushOnVisibilityChange: false,
      useBeaconOnUnload: false,
    })

    drain(makeRecord('info', { properties: { seq: 1 } }))
    drain(makeRecord('info', { properties: { seq: 2 } }))
    drain(makeRecord('info', { properties: { seq: 3 } }))

    await drain.flush()

    assert.strictEqual(calls.length, 1)
    assert.strictEqual(calls[0].url, '/api/logs')
    assert.strictEqual(calls[0].init.keepalive, true)
    assert.strictEqual(calls[0].init.method, 'POST')

    const body = JSON.parse(calls[0].init.body as string) as LogRecord[]
    assert.strictEqual(body.length, 3)
    assert.strictEqual(body[0].properties.seq, 1)
    assert.strictEqual(body[2].properties.seq, 3)
  })

  it('includes custom headers in fetch requests', async () => {
    const { fn: mockFetch, calls } = createMockFetch()
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch

    const drain = createBrowserDrain({
      endpoint: '/api/logs',
      headers: { Authorization: 'Bearer token123' },
      batch: { size: 1, intervalMs: 60000 },
      flushOnVisibilityChange: false,
      useBeaconOnUnload: false,
    })

    drain(makeRecord('info'))
    await drain.flush()

    const headers = calls[0].init.headers as Record<string, string>
    assert.strictEqual(headers['Authorization'], 'Bearer token123')
    assert.strictEqual(headers['Content-Type'], 'application/json')
  })

  it('uses custom HTTP method', async () => {
    const { fn: mockFetch, calls } = createMockFetch()
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch

    const drain = createBrowserDrain({
      endpoint: '/api/logs',
      method: 'PUT',
      batch: { size: 1, intervalMs: 60000 },
      flushOnVisibilityChange: false,
      useBeaconOnUnload: false,
    })

    drain(makeRecord('info'))
    await drain.flush()

    assert.strictEqual(calls[0].init.method, 'PUT')
  })

  it('uses custom serializer', async () => {
    const { fn: mockFetch, calls } = createMockFetch()
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch

    const drain = createBrowserDrain({
      endpoint: '/api/logs',
      serializer: (batch) => batch.map((r) => JSON.stringify(r)).join('\n'),
      batch: { size: 2, intervalMs: 60000 },
      flushOnVisibilityChange: false,
      useBeaconOnUnload: false,
    })

    drain(makeRecord('info', { properties: { a: 1 } }))
    drain(makeRecord('error', { properties: { b: 2 } }))
    await drain.flush()

    const body = calls[0].init.body as string
    const lines = body.split('\n')
    assert.strictEqual(lines.length, 2)
    assert.strictEqual(JSON.parse(lines[0]).properties.a, 1)
    assert.strictEqual(JSON.parse(lines[1]).properties.b, 2)
  })

  it('flushes incomplete batch on interval', async () => {
    const { fn: mockFetch, calls } = createMockFetch()
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch

    const drain = createBrowserDrain({
      endpoint: '/api/logs',
      batch: { size: 100, intervalMs: 20 },
      flushOnVisibilityChange: false,
      useBeaconOnUnload: false,
    })

    drain(makeRecord('info'))

    // Wait for the interval to trigger
    await new Promise((resolve) => setTimeout(resolve, 50))
    await drain.flush()

    assert.strictEqual(calls.length, 1)
    const body = JSON.parse(calls[0].init.body as string) as LogRecord[]
    assert.strictEqual(body.length, 1)
  })

  it('drops oldest records when buffer exceeds maxBufferSize', async () => {
    const { fn: mockFetch } = createMockFetch()
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch

    const dropped: { batch: readonly LogRecord[]; error: unknown }[] = []
    const drain = createBrowserDrain({
      endpoint: '/api/logs',
      batch: { size: 100, intervalMs: 60000 },
      maxBufferSize: 5,
      flushOnVisibilityChange: false,
      useBeaconOnUnload: false,
      onDropped: (batch, error) => {
        dropped.push({ batch, error })
      },
    })

    for (let i = 0; i < 7; i++) {
      drain(makeRecord('info', { properties: { seq: i } }))
    }

    await drain.flush()

    const droppedCount = dropped
      .filter((d) => (d.error as Error).message.includes('Buffer overflow'))
      .flatMap((d) => [...d.batch]).length
    assert.ok(droppedCount > 0, 'Should have dropped records due to overflow')
  })

  it('calls onDropped when fetch fails', async () => {
    const failingFetch = mock.fn(async () => {
      return new Response(null, { status: 500, statusText: 'Internal Server Error' })
    })
    globalThis.fetch = failingFetch as unknown as typeof globalThis.fetch

    const dropped: { batch: readonly LogRecord[]; error: unknown }[] = []
    const drain = createBrowserDrain({
      endpoint: '/api/logs',
      batch: { size: 1, intervalMs: 60000 },
      flushOnVisibilityChange: false,
      useBeaconOnUnload: false,
      onDropped: (batch, error) => {
        dropped.push({ batch, error })
      },
    })

    drain(makeRecord('error'))
    await drain.flush()

    assert.strictEqual(dropped.length, 1)
    assert.strictEqual(dropped[0].batch.length, 1)
    assert.ok(dropped[0].error instanceof Error)
    assert.ok((dropped[0].error as Error).message.includes('500'))
  })

  it('ignores records after disposal', async () => {
    const { fn: mockFetch, calls } = createMockFetch()
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch

    const drain = createBrowserDrain({
      endpoint: '/api/logs',
      batch: { size: 1, intervalMs: 60000 },
      flushOnVisibilityChange: false,
      useBeaconOnUnload: false,
    })

    drain(makeRecord('info'))
    await drain.flush()

    // After flush (sets disposed), new records should be ignored
    drain(makeRecord('error'))
    await drain.flush()

    // Only the first record should have been sent
    assert.strictEqual(calls.length, 1)
  })

  it('supports Symbol.asyncDispose', async () => {
    const { fn: mockFetch, calls } = createMockFetch()
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch

    const drain = createBrowserDrain({
      endpoint: '/api/logs',
      batch: { size: 100, intervalMs: 60000 },
      flushOnVisibilityChange: false,
      useBeaconOnUnload: false,
    })

    drain(makeRecord('info'))
    await drain[Symbol.asyncDispose]()

    assert.strictEqual(calls.length, 1)
  })

  it('is assignable to Sink type', () => {
    const drain = createBrowserDrain({
      endpoint: '/api/logs',
      flushOnVisibilityChange: false,
      useBeaconOnUnload: false,
    })
    const regularSink: Sink = drain
    assert.strictEqual(typeof regularSink, 'function')
  })

  it('handles multiple batches correctly', async () => {
    const { fn: mockFetch, calls } = createMockFetch()
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch

    const drain = createBrowserDrain({
      endpoint: '/api/logs',
      batch: { size: 2, intervalMs: 60000 },
      flushOnVisibilityChange: false,
      useBeaconOnUnload: false,
    })

    for (let i = 0; i < 5; i++) {
      drain(makeRecord('info', { properties: { seq: i } }))
    }

    await drain.flush()

    const allRecords = calls.flatMap((c) => JSON.parse(c.init.body as string) as LogRecord[])
    assert.strictEqual(allRecords.length, 5)
  })

  it('defaults Content-Type to application/json', async () => {
    const { fn: mockFetch, calls } = createMockFetch()
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch

    const drain = createBrowserDrain({
      endpoint: '/api/logs',
      batch: { size: 1, intervalMs: 60000 },
      flushOnVisibilityChange: false,
      useBeaconOnUnload: false,
    })

    drain(makeRecord('info'))
    await drain.flush()

    const headers = calls[0].init.headers as Record<string, string>
    assert.strictEqual(headers['Content-Type'], 'application/json')
  })

  it('custom headers override default Content-Type', async () => {
    const { fn: mockFetch, calls } = createMockFetch()
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch

    const drain = createBrowserDrain({
      endpoint: '/api/logs',
      headers: { 'Content-Type': 'application/x-ndjson' },
      batch: { size: 1, intervalMs: 60000 },
      flushOnVisibilityChange: false,
      useBeaconOnUnload: false,
    })

    drain(makeRecord('info'))
    await drain.flush()

    const headers = calls[0].init.headers as Record<string, string>
    assert.strictEqual(headers['Content-Type'], 'application/x-ndjson')
  })
})
