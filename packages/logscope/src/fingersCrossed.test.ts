import { describe, it } from 'node:test'
import assert from 'node:assert'
import { fingersCrossed } from './fingersCrossed.ts'
import type { LogRecord } from './record.ts'
import type { LogLevel } from './level.ts'

function makeRecord(level: LogLevel, overrides?: Partial<LogRecord>): LogRecord {
  return {
    category: ['test'],
    level,
    timestamp: Date.now(),
    message: ['test'],
    rawMessage: 'test',
    properties: {},
    ...overrides,
  }
}

describe('fingersCrossed', () => {
  it('buffers records below trigger level', () => {
    const received: LogRecord[] = []
    const sink = fingersCrossed((r) => received.push(r))

    sink(makeRecord('debug'))
    sink(makeRecord('info'))
    sink(makeRecord('warning'))

    assert.strictEqual(received.length, 0)
  })

  it('flushes buffer and trigger record when trigger level is reached', () => {
    const received: LogRecord[] = []
    const sink = fingersCrossed((r) => received.push(r))

    const debug = makeRecord('debug')
    const info = makeRecord('info')
    const error = makeRecord('error')

    sink(debug)
    sink(info)
    sink(error)

    assert.strictEqual(received.length, 3)
    assert.strictEqual(received[0], debug)
    assert.strictEqual(received[1], info)
    assert.strictEqual(received[2], error)
  })

  it('flushes on fatal (above default trigger level)', () => {
    const received: LogRecord[] = []
    const sink = fingersCrossed((r) => received.push(r))

    sink(makeRecord('info'))
    sink(makeRecord('fatal'))

    assert.strictEqual(received.length, 2)
  })

  it('uses custom trigger level', () => {
    const received: LogRecord[] = []
    const sink = fingersCrossed((r) => received.push(r), {
      triggerLevel: 'warning',
    })

    sink(makeRecord('debug'))
    sink(makeRecord('info'))

    assert.strictEqual(received.length, 0)

    sink(makeRecord('warning'))

    assert.strictEqual(received.length, 3)
  })

  it('passes through all records after trigger in passthrough mode', () => {
    const received: LogRecord[] = []
    const sink = fingersCrossed((r) => received.push(r), {
      afterTrigger: 'passthrough',
    })

    sink(makeRecord('info'))
    sink(makeRecord('error')) // triggers flush
    received.length = 0 // clear to test subsequent behavior

    sink(makeRecord('debug'))
    sink(makeRecord('trace'))

    assert.strictEqual(received.length, 2)
  })

  it('resets and buffers again after trigger in reset mode', () => {
    const received: LogRecord[] = []
    const sink = fingersCrossed((r) => received.push(r), {
      afterTrigger: 'reset',
    })

    sink(makeRecord('info'))
    sink(makeRecord('error')) // triggers flush

    assert.strictEqual(received.length, 2)
    received.length = 0

    // Should buffer again
    sink(makeRecord('debug'))
    sink(makeRecord('info'))

    assert.strictEqual(received.length, 0)

    // Trigger again
    sink(makeRecord('error'))

    assert.strictEqual(received.length, 3)
  })

  it('drops oldest records when buffer exceeds bufferSize', () => {
    const received: LogRecord[] = []
    const sink = fingersCrossed((r) => received.push(r), {
      bufferSize: 3,
    })

    const r1 = makeRecord('debug', { properties: { id: 1 } })
    const r2 = makeRecord('debug', { properties: { id: 2 } })
    const r3 = makeRecord('debug', { properties: { id: 3 } })
    const r4 = makeRecord('debug', { properties: { id: 4 } })
    const r5 = makeRecord('debug', { properties: { id: 5 } })

    sink(r1)
    sink(r2)
    sink(r3)
    sink(r4) // r1 dropped
    sink(r5) // r2 dropped

    sink(makeRecord('error')) // trigger

    // Should have r3, r4, r5, then the error
    assert.strictEqual(received.length, 4)
    assert.strictEqual(received[0].properties.id, 3)
    assert.strictEqual(received[1].properties.id, 4)
    assert.strictEqual(received[2].properties.id, 5)
  })

  it('default afterTrigger is passthrough', () => {
    const received: LogRecord[] = []
    const sink = fingersCrossed((r) => received.push(r))

    sink(makeRecord('error')) // trigger
    received.length = 0

    sink(makeRecord('trace'))
    assert.strictEqual(received.length, 1)
  })

  it('works with no buffer when trigger is first record', () => {
    const received: LogRecord[] = []
    const sink = fingersCrossed((r) => received.push(r))

    const error = makeRecord('error')
    sink(error)

    assert.strictEqual(received.length, 1)
    assert.strictEqual(received[0], error)
  })

  it('multiple triggers in reset mode each flush independently', () => {
    const received: LogRecord[] = []
    const sink = fingersCrossed((r) => received.push(r), {
      afterTrigger: 'reset',
    })

    // First cycle
    sink(makeRecord('info', { properties: { cycle: 1 } }))
    sink(makeRecord('error', { properties: { cycle: 1 } }))

    // Second cycle
    sink(makeRecord('info', { properties: { cycle: 2 } }))
    sink(makeRecord('error', { properties: { cycle: 2 } }))

    assert.strictEqual(received.length, 4)
    assert.strictEqual(received[0].properties.cycle, 1)
    assert.strictEqual(received[1].properties.cycle, 1)
    assert.strictEqual(received[2].properties.cycle, 2)
    assert.strictEqual(received[3].properties.cycle, 2)
  })
})
