import { describe, it, beforeEach, mock } from 'node:test'
import assert from 'node:assert'
import { getConsoleSink, getNonBlockingConsoleSink, getStreamSink, withFilter, fromAsyncSink } from './sink.ts'
import type { Sink } from './sink.ts'
import type { LogRecord } from './record.ts'
import type { LogLevel } from './level.ts'

function makeRecord(
  level: LogLevel,
  overrides?: Partial<LogRecord>,
): LogRecord {
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

describe('getConsoleSink', () => {
  let originalConsole: {
    debug: typeof console.debug
    info: typeof console.info
    warn: typeof console.warn
    error: typeof console.error
  }

  beforeEach(() => {
    originalConsole = {
      debug: console.debug,
      info: console.info,
      warn: console.warn,
      error: console.error,
    }
  })

  // Restore console after each test implicitly via mocking

  it('calls console.info for info-level records', () => {
    const fn = mock.fn()
    console.info = fn
    try {
      const sink = getConsoleSink()
      sink(makeRecord('info'))
      assert.strictEqual(fn.mock.calls.length, 1)
    } finally {
      console.info = originalConsole.info
    }
  })

  it('calls console.error for error-level records', () => {
    const fn = mock.fn()
    console.error = fn
    try {
      const sink = getConsoleSink()
      sink(makeRecord('error'))
      assert.strictEqual(fn.mock.calls.length, 1)
    } finally {
      console.error = originalConsole.error
    }
  })

  it('calls console.warn for warning-level records', () => {
    const fn = mock.fn()
    console.warn = fn
    try {
      const sink = getConsoleSink()
      sink(makeRecord('warning'))
      assert.strictEqual(fn.mock.calls.length, 1)
    } finally {
      console.warn = originalConsole.warn
    }
  })

  it('calls console.debug for trace-level records', () => {
    const fn = mock.fn()
    console.debug = fn
    try {
      const sink = getConsoleSink()
      sink(makeRecord('trace'))
      assert.strictEqual(fn.mock.calls.length, 1)
    } finally {
      console.debug = originalConsole.debug
    }
  })

  it('calls console.debug for debug-level records', () => {
    const fn = mock.fn()
    console.debug = fn
    try {
      const sink = getConsoleSink()
      sink(makeRecord('debug'))
      assert.strictEqual(fn.mock.calls.length, 1)
    } finally {
      console.debug = originalConsole.debug
    }
  })

  it('calls console.error for fatal-level records', () => {
    const fn = mock.fn()
    console.error = fn
    try {
      const sink = getConsoleSink()
      sink(makeRecord('fatal'))
      assert.strictEqual(fn.mock.calls.length, 1)
    } finally {
      console.error = originalConsole.error
    }
  })

  it('uses a custom formatter when provided', () => {
    const fn = mock.fn()
    console.info = fn
    try {
      const formatter = (record: LogRecord) =>
        `CUSTOM: ${record.level} - ${record.rawMessage}`
      const sink = getConsoleSink({ formatter })
      sink(makeRecord('info'))
      assert.strictEqual(fn.mock.calls.length, 1)
      assert.strictEqual(fn.mock.calls[0].arguments[0], 'CUSTOM: info - test message')
    } finally {
      console.info = originalConsole.info
    }
  })

  it('default formatter includes timestamp, level, category, message, and properties', () => {
    const fn = mock.fn()
    console.info = fn
    try {
      const sink = getConsoleSink()
      const record = makeRecord('info', {
        category: ['my-app', 'db'],
        timestamp: new Date('2024-01-15T10:30:00.000Z').getTime(),
        message: ['query executed'],
        rawMessage: 'query executed',
        properties: { table: 'users', ms: 42 },
      })
      sink(record)
      const output: string = fn.mock.calls[0].arguments[0]
      assert.ok(output.includes('2024-01-15T10:30:00.000Z'))
      assert.ok(output.includes('[INFO]'))
      assert.ok(output.includes('my-app · db'))
      assert.ok(output.includes('query executed'))
      assert.ok(output.includes('"table":"users"'))
      assert.ok(output.includes('"ms":42'))
    } finally {
      console.info = originalConsole.info
    }
  })
})

describe('withFilter', () => {
  it('blocks records that fail the filter', () => {
    const calls: LogRecord[] = []
    const innerSink: Sink = (record) => calls.push(record)
    const filtered = withFilter(innerSink, 'warning')

    filtered(makeRecord('info'))
    filtered(makeRecord('debug'))
    assert.strictEqual(calls.length, 0)
  })

  it('passes records that satisfy the filter', () => {
    const calls: LogRecord[] = []
    const innerSink: Sink = (record) => calls.push(record)
    const filtered = withFilter(innerSink, 'warning')

    filtered(makeRecord('warning'))
    filtered(makeRecord('error'))
    filtered(makeRecord('fatal'))
    assert.strictEqual(calls.length, 3)
  })

  it('works with a custom filter function', () => {
    const calls: LogRecord[] = []
    const innerSink: Sink = (record) => calls.push(record)
    const filtered = withFilter(innerSink, (record) => record.level === 'error')

    filtered(makeRecord('info'))
    filtered(makeRecord('error'))
    filtered(makeRecord('fatal'))
    assert.strictEqual(calls.length, 1)
    assert.strictEqual(calls[0].level, 'error')
  })

  it('works with null filter (blocks everything)', () => {
    const calls: LogRecord[] = []
    const innerSink: Sink = (record) => calls.push(record)
    const filtered = withFilter(innerSink, null)

    filtered(makeRecord('fatal'))
    assert.strictEqual(calls.length, 0)
  })
})

describe('getNonBlockingConsoleSink', () => {
  let originalConsole: {
    debug: typeof console.debug
    info: typeof console.info
    warn: typeof console.warn
    error: typeof console.error
  }

  beforeEach(() => {
    originalConsole = {
      debug: console.debug,
      info: console.info,
      warn: console.warn,
      error: console.error,
    }
  })

  it('does not call console synchronously', async () => {
    const fn = mock.fn()
    console.info = fn
    try {
      const sink = getNonBlockingConsoleSink()
      sink(makeRecord('info'))
      // Should NOT have been called yet — buffered for async drain
      assert.strictEqual(fn.mock.calls.length, 0)
      // Clean up: flush so the drain doesn't leak into other tests
      await sink.flush()
    } finally {
      console.info = originalConsole.info
    }
  })

  it('drains buffered records asynchronously', async () => {
    const fn = mock.fn()
    console.info = fn
    try {
      const sink = getNonBlockingConsoleSink()
      sink(makeRecord('info'))
      sink(makeRecord('info'))

      // Wait for the setTimeout(0) drain
      await new Promise((resolve) => setTimeout(resolve, 10))

      assert.strictEqual(fn.mock.calls.length, 2)
    } finally {
      console.info = originalConsole.info
    }
  })

  it('flush drains immediately without waiting for timeout', async () => {
    const fn = mock.fn()
    console.info = fn
    try {
      const sink = getNonBlockingConsoleSink()
      sink(makeRecord('info'))
      sink(makeRecord('info'))

      await sink.flush()
      assert.strictEqual(fn.mock.calls.length, 2)
    } finally {
      console.info = originalConsole.info
    }
  })

  it('maps levels to correct console methods', async () => {
    const infoFn = mock.fn()
    const errorFn = mock.fn()
    const warnFn = mock.fn()
    const debugFn = mock.fn()
    console.info = infoFn
    console.error = errorFn
    console.warn = warnFn
    console.debug = debugFn
    try {
      const sink = getNonBlockingConsoleSink()
      sink(makeRecord('info'))
      sink(makeRecord('error'))
      sink(makeRecord('warning'))
      sink(makeRecord('debug'))

      await sink.flush()
      assert.strictEqual(infoFn.mock.calls.length, 1)
      assert.strictEqual(errorFn.mock.calls.length, 1)
      assert.strictEqual(warnFn.mock.calls.length, 1)
      assert.strictEqual(debugFn.mock.calls.length, 1)
    } finally {
      console.info = originalConsole.info
      console.error = originalConsole.error
      console.warn = originalConsole.warn
      console.debug = originalConsole.debug
    }
  })

  it('uses a custom formatter when provided', async () => {
    const fn = mock.fn()
    console.info = fn
    try {
      const sink = getNonBlockingConsoleSink({
        formatter: (record) => `CUSTOM: ${record.rawMessage}`,
      })
      sink(makeRecord('info', { rawMessage: 'hello' }))

      await sink.flush()
      assert.strictEqual(fn.mock.calls[0].arguments[0], 'CUSTOM: hello')
    } finally {
      console.info = originalConsole.info
    }
  })

  it('supports Symbol.asyncDispose', async () => {
    const fn = mock.fn()
    console.info = fn
    try {
      const sink = getNonBlockingConsoleSink()
      sink(makeRecord('info'))

      await sink[Symbol.asyncDispose]()
      assert.strictEqual(fn.mock.calls.length, 1)
    } finally {
      console.info = originalConsole.info
    }
  })

  it('is assignable to Sink type', () => {
    const sink = getNonBlockingConsoleSink()
    const regularSink: Sink = sink
    assert.strictEqual(typeof regularSink, 'function')
  })
})

describe('getStreamSink', () => {
  function collectStream(): { stream: WritableStream<Uint8Array>; chunks: Uint8Array[] } {
    const chunks: Uint8Array[] = []
    const stream = new WritableStream<Uint8Array>({
      write(chunk) {
        chunks.push(chunk)
      },
    })
    return { stream, chunks }
  }

  function decodeChunks(chunks: Uint8Array[]): string {
    const decoder = new TextDecoder()
    return chunks.map((c) => decoder.decode(c)).join('')
  }

  it('writes formatted records to the stream', async () => {
    const { stream, chunks } = collectStream()
    const sink = getStreamSink(stream, {
      formatter: (record) => `${record.level}: ${record.rawMessage}`,
    })

    sink(makeRecord('info', { rawMessage: 'hello' }))
    sink(makeRecord('error', { rawMessage: 'oops' }))
    await sink.flush()

    const output = decodeChunks(chunks)
    assert.ok(output.includes('info: hello\n'))
    assert.ok(output.includes('error: oops\n'))
  })

  it('preserves write ordering', async () => {
    const { stream, chunks } = collectStream()
    const sink = getStreamSink(stream, {
      formatter: (record) => `${record.properties.seq}`,
    })

    sink(makeRecord('info', { properties: { seq: 1 } }))
    sink(makeRecord('info', { properties: { seq: 2 } }))
    sink(makeRecord('info', { properties: { seq: 3 } }))
    await sink.flush()

    const output = decodeChunks(chunks)
    assert.strictEqual(output, '1\n2\n3\n')
  })

  it('appends a newline after each record', async () => {
    const { stream, chunks } = collectStream()
    const sink = getStreamSink(stream, {
      formatter: () => 'line',
    })

    sink(makeRecord('info'))
    await sink.flush()

    const output = decodeChunks(chunks)
    assert.strictEqual(output, 'line\n')
  })

  it('uses default text formatter when none provided', async () => {
    const { stream, chunks } = collectStream()
    const sink = getStreamSink(stream)

    sink(makeRecord('info', {
      category: ['app'],
      message: ['test msg'],
      rawMessage: 'test msg',
      timestamp: new Date('2024-01-15T10:30:00.000Z').getTime(),
    }))
    await sink.flush()

    const output = decodeChunks(chunks)
    assert.ok(output.includes('[INFO]'))
    assert.ok(output.includes('test msg'))
    assert.ok(output.includes('app'))
  })

  it('is a DisposableSink with flush and asyncDispose', async () => {
    const { stream } = collectStream()
    const sink = getStreamSink(stream, { formatter: () => 'x' })

    assert.strictEqual(typeof sink.flush, 'function')
    assert.strictEqual(typeof sink[Symbol.asyncDispose], 'function')

    sink(makeRecord('info'))
    await sink[Symbol.asyncDispose]()
  })

  it('is assignable to Sink type', () => {
    const { stream } = collectStream()
    const sink = getStreamSink(stream, { formatter: () => 'x' })
    const regularSink: Sink = sink
    assert.strictEqual(typeof regularSink, 'function')
  })
})

describe('fromAsyncSink', () => {
  it('calls the async function for each record', async () => {
    const received: LogRecord[] = []
    const sink = fromAsyncSink(async (record) => {
      received.push(record)
    })

    sink(makeRecord('info'))
    sink(makeRecord('error'))
    await sink.flush()
    assert.strictEqual(received.length, 2)
    assert.strictEqual(received[0].level, 'info')
    assert.strictEqual(received[1].level, 'error')
  })

  it('preserves write ordering', async () => {
    const order: number[] = []
    const sink = fromAsyncSink(async (record) => {
      const delay = record.properties.delay as number
      await new Promise((resolve) => setTimeout(resolve, delay))
      order.push(record.properties.seq as number)
    })

    // First record takes longer than second — ordering should still be preserved
    sink(makeRecord('info', { properties: { seq: 1, delay: 30 } }))
    sink(makeRecord('info', { properties: { seq: 2, delay: 5 } }))
    await sink.flush()
    assert.deepStrictEqual(order, [1, 2])
  })

  it('flush resolves after all pending writes complete', async () => {
    let completed = false
    const sink = fromAsyncSink(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      completed = true
    })

    sink(makeRecord('info'))
    assert.strictEqual(completed, false)
    await sink.flush()
    assert.strictEqual(completed, true)
  })

  it('is assignable to Sink type', () => {
    const sink = fromAsyncSink(async () => {})
    const regularSink: Sink = sink
    regularSink(makeRecord('info'))
  })

  it('supports Symbol.asyncDispose', async () => {
    let flushed = false
    const sink = fromAsyncSink(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      flushed = true
    })

    sink(makeRecord('info'))
    await sink[Symbol.asyncDispose]()
    assert.strictEqual(flushed, true)
  })
})

describe('custom sink', () => {
  it('receives the full LogRecord', () => {
    const received: LogRecord[] = []
    const customSink: Sink = (record) => received.push(record)

    const record = makeRecord('info', {
      category: ['app', 'auth'],
      message: ['user logged in'],
      rawMessage: 'user logged in',
      properties: { userId: '123' },
    })

    customSink(record)
    assert.strictEqual(received.length, 1)
    assert.deepStrictEqual(received[0].category, ['app', 'auth'])
    assert.strictEqual(received[0].level, 'info')
    assert.deepStrictEqual(received[0].message, ['user logged in'])
    assert.strictEqual(received[0].properties.userId, '123')
  })
})
