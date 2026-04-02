import { describe, it } from 'node:test'
import assert from 'node:assert'
import type { LogRecord } from 'logscope'
import {
  toSentryEvent,
  toSentryEvents,
  parseDsn,
  toEnvelopeBody,
  parseStackFrames,
} from './mapping.ts'

function makeRecord(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    category: ['my-app'],
    level: 'info',
    timestamp: 1700000000000,
    message: ['hello world'],
    rawMessage: 'hello world',
    properties: {},
    ...overrides,
  }
}

describe('toSentryEvent', () => {
  it('converts a basic record to a Sentry event', () => {
    const event = toSentryEvent(makeRecord())

    assert.strictEqual(event.timestamp, 1700000000)
    assert.strictEqual(event.level, 'info')
    assert.strictEqual(event.logger, 'my-app')
    assert.strictEqual(event.platform, 'javascript')
    assert.deepStrictEqual(event.message, { formatted: 'hello world' })
    assert.ok(event.event_id.length === 32)
  })

  it('maps all log levels correctly', () => {
    const levels: Array<{ level: LogRecord['level']; expected: string }> = [
      { level: 'trace', expected: 'debug' },
      { level: 'debug', expected: 'debug' },
      { level: 'info', expected: 'info' },
      { level: 'warning', expected: 'warning' },
      { level: 'error', expected: 'error' },
      { level: 'fatal', expected: 'fatal' },
    ]

    for (const { level, expected } of levels) {
      const event = toSentryEvent(makeRecord({ level }))
      assert.strictEqual(event.level, expected, `level ${level} should map to ${expected}`)
    }
  })

  it('joins category with dots', () => {
    const event = toSentryEvent(makeRecord({ category: ['my-app', 'db', 'queries'] }))
    assert.strictEqual(event.logger, 'my-app.db.queries')
  })

  it('attaches properties as extra data', () => {
    const event = toSentryEvent(
      makeRecord({ properties: { userId: '123', duration: 42, path: '/api/users' } }),
    )

    assert.deepStrictEqual(event.extra, { userId: '123', duration: 42, path: '/api/users' })
  })

  it('renders interleaved message parts', () => {
    const event = toSentryEvent(makeRecord({ message: ['user ', 'Alice', ' logged in'] }))
    assert.deepStrictEqual(event.message, { formatted: 'user Alice logged in' })
  })

  it('omits message when empty', () => {
    const event = toSentryEvent(makeRecord({ message: [], rawMessage: '' }))
    assert.strictEqual(event.message, undefined)
  })

  it('falls back to rawMessage when message array is empty', () => {
    const event = toSentryEvent(makeRecord({ message: [], rawMessage: 'raw fallback' }))
    assert.deepStrictEqual(event.message, { formatted: 'raw fallback' })
  })

  it('extracts Error into exception interface', () => {
    const err = new Error('something broke')
    const event = toSentryEvent(makeRecord({ level: 'error', properties: { error: err } }))

    assert.ok(event.exception)
    assert.strictEqual(event.exception!.values.length, 1)
    assert.strictEqual(event.exception!.values[0].type, 'Error')
    assert.strictEqual(event.exception!.values[0].value, 'something broke')
  })

  it('extracts Error from "err" property', () => {
    const err = new Error('oops')
    const event = toSentryEvent(makeRecord({ properties: { err } }))

    assert.ok(event.exception)
    assert.strictEqual(event.exception!.values[0].value, 'oops')
  })

  it('extracts Error from "exception" property', () => {
    const err = new Error('exc')
    const event = toSentryEvent(makeRecord({ properties: { exception: err } }))

    assert.ok(event.exception)
    assert.strictEqual(event.exception!.values[0].value, 'exc')
  })

  it('builds exception chain from Error.cause', () => {
    const root = new Error('root cause')
    const wrapper = new Error('wrapper')
    wrapper.cause = root

    const event = toSentryEvent(makeRecord({ properties: { error: wrapper } }))

    assert.ok(event.exception)
    assert.strictEqual(event.exception!.values.length, 2)
    // Sentry expects outermost last
    assert.strictEqual(event.exception!.values[0].value, 'root cause')
    assert.strictEqual(event.exception!.values[1].value, 'wrapper')
  })

  it('does not include Error objects in extra', () => {
    const err = new Error('fail')
    const event = toSentryEvent(
      makeRecord({ properties: { error: err, userId: '123' } }),
    )

    assert.strictEqual(event.extra?.error, undefined)
    assert.strictEqual(event.extra?.userId, '123')
  })

  it('omits extra when only Error properties exist', () => {
    const err = new Error('fail')
    const event = toSentryEvent(makeRecord({ properties: { error: err } }))

    assert.strictEqual(event.extra, undefined)
  })

  it('serializes BigInt values in extra', () => {
    const event = toSentryEvent(makeRecord({ properties: { bigId: BigInt('9007199254740993') } }))
    assert.strictEqual(event.extra?.bigId, '9007199254740993')
  })

  it('serializes Date values in extra', () => {
    const date = new Date('2024-01-15T10:30:00.000Z')
    const event = toSentryEvent(makeRecord({ properties: { createdAt: date } }))
    assert.strictEqual(event.extra?.createdAt, '2024-01-15T10:30:00.000Z')
  })

  it('converts timestamp from ms to seconds', () => {
    const event = toSentryEvent(makeRecord({ timestamp: 1700000000123 }))
    assert.strictEqual(event.timestamp, 1700000000.123)
  })

  it('generates unique event IDs', () => {
    const event1 = toSentryEvent(makeRecord())
    const event2 = toSentryEvent(makeRecord())
    assert.notStrictEqual(event1.event_id, event2.event_id)
  })

  it('produces JSON.stringify-safe output', () => {
    const event = toSentryEvent(
      makeRecord({ properties: { nested: { deep: true }, count: 42 } }),
    )
    const json = JSON.stringify(event)
    assert.ok(json.length > 0)
    const parsed = JSON.parse(json)
    assert.strictEqual(parsed.level, 'info')
  })
})

describe('toSentryEvents', () => {
  it('converts a batch of records', () => {
    const records = [
      makeRecord({ level: 'info', properties: { a: 1 } }),
      makeRecord({ level: 'error', properties: { b: 2 } }),
      makeRecord({ level: 'debug', properties: { c: 3 } }),
    ]

    const events = toSentryEvents(records)
    assert.strictEqual(events.length, 3)
    assert.strictEqual(events[0].level, 'info')
    assert.strictEqual(events[1].level, 'error')
    assert.strictEqual(events[2].level, 'debug')
  })

  it('returns empty array for empty batch', () => {
    assert.deepStrictEqual(toSentryEvents([]), [])
  })
})

describe('parseDsn', () => {
  it('parses a standard Sentry DSN', () => {
    const result = parseDsn('https://abc123@o0.ingest.sentry.io/12345')

    assert.strictEqual(result.publicKey, 'abc123')
    assert.strictEqual(result.host, 'https://o0.ingest.sentry.io')
    assert.strictEqual(result.projectId, '12345')
  })

  it('handles DSN with path prefix', () => {
    const result = parseDsn('https://key@sentry.example.com/prefix/42')

    assert.strictEqual(result.publicKey, 'key')
    assert.strictEqual(result.host, 'https://sentry.example.com/prefix')
    assert.strictEqual(result.projectId, '42')
  })

  it('throws on invalid DSN', () => {
    assert.throws(() => parseDsn('not-a-url'), /Invalid Sentry DSN/)
  })

  it('throws on DSN without public key', () => {
    assert.throws(() => parseDsn('https://sentry.io/12345'), /missing public key/)
  })

  it('throws on DSN without project ID', () => {
    assert.throws(() => parseDsn('https://key@sentry.io'), /missing project ID/)
  })
})

describe('parseStackFrames', () => {
  it('parses V8-style stack traces', () => {
    const stack = [
      'Error: something broke',
      '    at doStuff (/app/src/handler.ts:42:13)',
      '    at processRequest (/app/src/server.ts:100:5)',
      '    at Module._compile (node:internal/modules/cjs/loader:1234:14)',
    ].join('\n')

    const frames = parseStackFrames(stack)

    // Reversed: oldest first
    assert.strictEqual(frames.length, 3)
    assert.strictEqual(frames[2].function, 'doStuff')
    assert.strictEqual(frames[2].filename, '/app/src/handler.ts')
    assert.strictEqual(frames[2].lineno, 42)
    assert.strictEqual(frames[2].colno, 13)
    assert.strictEqual(frames[2].in_app, true)

    assert.strictEqual(frames[0].function, 'Module._compile')
    assert.strictEqual(frames[0].in_app, true)
  })

  it('marks node_modules frames as not in_app', () => {
    const stack = [
      'Error: fail',
      '    at handler (/app/node_modules/express/lib/router.js:10:5)',
    ].join('\n')

    const frames = parseStackFrames(stack)
    assert.strictEqual(frames[0].in_app, false)
  })

  it('handles anonymous stack frames', () => {
    const stack = [
      'Error: fail',
      '    at /app/src/index.ts:5:10',
    ].join('\n')

    const frames = parseStackFrames(stack)
    assert.strictEqual(frames[0].filename, '/app/src/index.ts')
    assert.strictEqual(frames[0].lineno, 5)
    assert.strictEqual(frames[0].function, undefined)
  })
})

describe('toEnvelopeBody', () => {
  it('produces valid envelope format', () => {
    const event = toSentryEvent(makeRecord())
    const dsn = 'https://key@sentry.io/123'
    const body = toEnvelopeBody([event], dsn)

    const lines = body.split('\n')
    assert.strictEqual(lines.length, 3)

    const header = JSON.parse(lines[0])
    assert.strictEqual(header.event_id, event.event_id)
    assert.strictEqual(header.dsn, dsn)
    assert.ok(header.sent_at)

    const itemHeader = JSON.parse(lines[1])
    assert.strictEqual(itemHeader.type, 'event')
    assert.strictEqual(itemHeader.content_type, 'application/json')

    const payload = JSON.parse(lines[2])
    assert.strictEqual(payload.level, 'info')
    assert.strictEqual(payload.logger, 'my-app')
  })

  it('handles multiple events in one envelope', () => {
    const events = [
      toSentryEvent(makeRecord({ level: 'info' })),
      toSentryEvent(makeRecord({ level: 'error' })),
    ]
    const body = toEnvelopeBody(events, 'https://key@sentry.io/123')

    const lines = body.split('\n')
    // 3 lines per event, joined by \n between events
    assert.strictEqual(lines.length, 6)
  })
})
