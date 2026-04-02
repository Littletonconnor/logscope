import { describe, it } from 'node:test'
import assert from 'node:assert'
import type { LogRecord } from 'logscope'
import { toAxiomEvent, toAxiomEvents } from './mapping.ts'

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

describe('toAxiomEvent', () => {
  it('converts a basic record to an Axiom event', () => {
    const event = toAxiomEvent(makeRecord())

    assert.strictEqual(event._time, '2023-11-14T22:13:20.000Z')
    assert.strictEqual(event.level, 'INFO')
    assert.strictEqual(event.logger, 'my-app')
    assert.strictEqual(event.message, 'hello world')
  })

  it('maps all log levels correctly', () => {
    const levels: Array<{ level: LogRecord['level']; expected: string }> = [
      { level: 'trace', expected: 'TRACE' },
      { level: 'debug', expected: 'DEBUG' },
      { level: 'info', expected: 'INFO' },
      { level: 'warning', expected: 'WARN' },
      { level: 'error', expected: 'ERROR' },
      { level: 'fatal', expected: 'FATAL' },
    ]

    for (const { level, expected } of levels) {
      const event = toAxiomEvent(makeRecord({ level }))
      assert.strictEqual(event.level, expected, `level ${level} should map to ${expected}`)
    }
  })

  it('joins category with dots', () => {
    const event = toAxiomEvent(makeRecord({ category: ['my-app', 'db', 'queries'] }))
    assert.strictEqual(event.logger, 'my-app.db.queries')
  })

  it('spreads properties at the top level', () => {
    const event = toAxiomEvent(
      makeRecord({ properties: { userId: '123', duration: 42, path: '/api/users' } }),
    )

    assert.strictEqual(event.userId, '123')
    assert.strictEqual(event.duration, 42)
    assert.strictEqual(event.path, '/api/users')
  })

  it('renders interleaved message parts', () => {
    const event = toAxiomEvent(makeRecord({ message: ['user ', 'Alice', ' logged in'] }))
    assert.strictEqual(event.message, 'user Alice logged in')
  })

  it('omits message when empty', () => {
    const event = toAxiomEvent(makeRecord({ message: [], rawMessage: '' }))
    assert.strictEqual(event.message, undefined)
  })

  it('falls back to rawMessage when message array is empty', () => {
    const event = toAxiomEvent(makeRecord({ message: [], rawMessage: 'raw fallback' }))
    assert.strictEqual(event.message, 'raw fallback')
  })

  it('serializes Error objects in properties', () => {
    const err = new Error('something broke')
    err.cause = new Error('root cause')
    const event = toAxiomEvent(makeRecord({ properties: { error: err } }))

    const serialized = event.error as Record<string, unknown>
    assert.strictEqual(serialized.name, 'Error')
    assert.strictEqual(serialized.message, 'something broke')
    assert.ok(serialized.stack)
    assert.ok(serialized.cause)
  })

  it('serializes nested objects', () => {
    const event = toAxiomEvent(
      makeRecord({ properties: { user: { id: '123', plan: 'premium' } } }),
    )

    assert.deepStrictEqual(event.user, { id: '123', plan: 'premium' })
  })

  it('serializes BigInt values as strings', () => {
    const event = toAxiomEvent(makeRecord({ properties: { bigId: BigInt('9007199254740993') } }))
    assert.strictEqual(event.bigId, '9007199254740993')
  })

  it('serializes Date values as ISO strings', () => {
    const date = new Date('2024-01-15T10:30:00.000Z')
    const event = toAxiomEvent(makeRecord({ properties: { createdAt: date } }))
    assert.strictEqual(event.createdAt, '2024-01-15T10:30:00.000Z')
  })

  it('produces JSON.stringify-safe output', () => {
    const event = toAxiomEvent(
      makeRecord({ properties: { nested: { deep: true }, count: 42 } }),
    )
    const json = JSON.stringify(event)
    assert.ok(json.length > 0)
    const parsed = JSON.parse(json)
    assert.strictEqual(parsed.level, 'INFO')
  })
})

describe('toAxiomEvents', () => {
  it('converts a batch of records', () => {
    const records = [
      makeRecord({ level: 'info', properties: { a: 1 } }),
      makeRecord({ level: 'error', properties: { b: 2 } }),
      makeRecord({ level: 'debug', properties: { c: 3 } }),
    ]

    const events = toAxiomEvents(records)
    assert.strictEqual(events.length, 3)
    assert.strictEqual(events[0].level, 'INFO')
    assert.strictEqual(events[1].level, 'ERROR')
    assert.strictEqual(events[2].level, 'DEBUG')
    assert.strictEqual(events[0].a, 1)
    assert.strictEqual(events[1].b, 2)
    assert.strictEqual(events[2].c, 3)
  })

  it('returns empty array for empty batch', () => {
    assert.deepStrictEqual(toAxiomEvents([]), [])
  })
})
