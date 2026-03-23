import { describe, it, beforeEach, mock } from 'node:test'
import assert from 'node:assert'
import { getConsoleSink, withFilter } from './sink.ts'
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
