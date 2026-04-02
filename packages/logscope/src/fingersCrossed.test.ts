import { describe, it } from 'node:test'
import assert from 'node:assert'
import { fingersCrossed, categoryIsolation, propertyIsolation } from './fingersCrossed.ts'
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

describe('fingersCrossed with category isolation', () => {
  it('isolates buffers by category', () => {
    const received: LogRecord[] = []
    const sink = fingersCrossed((r) => received.push(r), {
      isolation: categoryIsolation(),
      afterTrigger: 'reset',
    })

    // Buffer records in two different categories
    sink(makeRecord('debug', { category: ['app', 'db'] }))
    sink(makeRecord('debug', { category: ['app', 'auth'] }))

    // Trigger only in db category
    sink(makeRecord('error', { category: ['app', 'db'] }))

    // Only db records should flush (the debug + the error)
    assert.strictEqual(received.length, 2)
    assert.deepStrictEqual(received[0].category, ['app', 'db'])
    assert.deepStrictEqual(received[1].category, ['app', 'db'])

    // Auth buffer is still silent
    received.length = 0
    sink(makeRecord('debug', { category: ['app', 'auth'] }))
    assert.strictEqual(received.length, 0)
  })

  it('flushes descendants when configured', () => {
    const received: LogRecord[] = []
    const sink = fingersCrossed((r) => received.push(r), {
      isolation: categoryIsolation({ flush: 'descendants' }),
      afterTrigger: 'reset',
    })

    // Buffer in parent and child categories
    sink(makeRecord('debug', { category: ['app'] }))
    sink(makeRecord('debug', { category: ['app', 'db'] }))
    sink(makeRecord('debug', { category: ['app', 'db', 'queries'] }))
    sink(makeRecord('debug', { category: ['other'] }))

    // Trigger at app.db — should flush app.db and app.db.queries (descendants)
    sink(makeRecord('error', { category: ['app', 'db'] }))

    // app.db debug + app.db.queries debug + error = 3
    // app and other should NOT be flushed
    const flushedCategories = received.map((r) => r.category.join('.'))
    assert.ok(flushedCategories.includes('app.db'))
    assert.ok(flushedCategories.includes('app.db.queries'))
    assert.ok(!flushedCategories.includes('app'))
    assert.ok(!flushedCategories.includes('other'))
  })

  it('flushes ancestors when configured', () => {
    const received: LogRecord[] = []
    const sink = fingersCrossed((r) => received.push(r), {
      isolation: categoryIsolation({ flush: 'ancestors' }),
      afterTrigger: 'reset',
    })

    sink(makeRecord('debug', { category: ['app'] }))
    sink(makeRecord('debug', { category: ['app', 'db'] }))
    sink(makeRecord('debug', { category: ['app', 'db', 'queries'] }))
    sink(makeRecord('debug', { category: ['other'] }))

    // Trigger at app.db — should flush app.db and app (ancestor)
    sink(makeRecord('error', { category: ['app', 'db'] }))

    const flushedCategories = received.map((r) => r.category.join('.'))
    assert.ok(flushedCategories.includes('app.db'))
    assert.ok(flushedCategories.includes('app'))
    assert.ok(!flushedCategories.includes('app.db.queries'))
    assert.ok(!flushedCategories.includes('other'))
  })

  it('flushes both ancestors and descendants when configured', () => {
    const received: LogRecord[] = []
    const sink = fingersCrossed((r) => received.push(r), {
      isolation: categoryIsolation({ flush: 'both' }),
      afterTrigger: 'reset',
    })

    sink(makeRecord('debug', { category: ['app'] }))
    sink(makeRecord('debug', { category: ['app', 'db'] }))
    sink(makeRecord('debug', { category: ['app', 'db', 'queries'] }))
    sink(makeRecord('debug', { category: ['other'] }))

    // Trigger at app.db — should flush app, app.db, and app.db.queries
    sink(makeRecord('error', { category: ['app', 'db'] }))

    const flushedCategories = received.map((r) => r.category.join('.'))
    assert.ok(flushedCategories.includes('app'))
    assert.ok(flushedCategories.includes('app.db'))
    assert.ok(flushedCategories.includes('app.db.queries'))
    assert.ok(!flushedCategories.includes('other'))
  })

  it('uses depth to control category key granularity', () => {
    const received: LogRecord[] = []
    const sink = fingersCrossed((r) => received.push(r), {
      isolation: categoryIsolation({ depth: 1 }),
      afterTrigger: 'reset',
    })

    // Both share key "app" because depth=1
    sink(makeRecord('debug', { category: ['app', 'db'] }))
    sink(makeRecord('debug', { category: ['app', 'auth'] }))
    sink(makeRecord('debug', { category: ['other'] }))

    // Trigger in app.db — key is "app", so both app.db and app.auth flush
    sink(makeRecord('error', { category: ['app', 'db'] }))

    assert.strictEqual(received.length, 3) // 2 debug + 1 error
    // "other" stays buffered
    const hasOther = received.some((r) => r.category[0] === 'other')
    assert.strictEqual(hasOther, false)
  })

  it('passthrough mode works per category', () => {
    const received: LogRecord[] = []
    const sink = fingersCrossed((r) => received.push(r), {
      isolation: categoryIsolation(),
      afterTrigger: 'passthrough',
    })

    // Trigger db category
    sink(makeRecord('error', { category: ['app', 'db'] }))
    received.length = 0

    // db is now passthrough, auth is still buffering
    sink(makeRecord('debug', { category: ['app', 'db'] }))
    sink(makeRecord('debug', { category: ['app', 'auth'] }))

    assert.strictEqual(received.length, 1)
    assert.deepStrictEqual(received[0].category, ['app', 'db'])
  })
})

describe('fingersCrossed with property isolation', () => {
  it('isolates buffers by property value', () => {
    const received: LogRecord[] = []
    const sink = fingersCrossed((r) => received.push(r), {
      isolation: propertyIsolation('requestId'),
      afterTrigger: 'reset',
    })

    // Two concurrent requests
    sink(makeRecord('debug', { properties: { requestId: 'req-1', step: 'start' } }))
    sink(makeRecord('debug', { properties: { requestId: 'req-2', step: 'start' } }))
    sink(makeRecord('info', { properties: { requestId: 'req-1', step: 'query' } }))
    sink(makeRecord('info', { properties: { requestId: 'req-2', step: 'query' } }))

    // Only req-1 errors
    sink(makeRecord('error', { properties: { requestId: 'req-1', step: 'fail' } }))

    // Should only see req-1 records
    assert.strictEqual(received.length, 3) // 2 buffered + 1 error
    assert.ok(received.every((r) => r.properties.requestId === 'req-1'))

    // req-2 is still buffered
    received.length = 0
    sink(makeRecord('debug', { properties: { requestId: 'req-2', step: 'more' } }))
    assert.strictEqual(received.length, 0)
  })

  it('handles undefined property as fallback buffer', () => {
    const received: LogRecord[] = []
    const sink = fingersCrossed((r) => received.push(r), {
      isolation: propertyIsolation('requestId'),
      afterTrigger: 'reset',
    })

    // Record with no requestId goes to fallback
    sink(makeRecord('debug', { properties: { other: 'value' } }))
    sink(makeRecord('debug', { properties: { requestId: 'req-1' } }))

    // Trigger with no requestId — only fallback flushes
    sink(makeRecord('error', { properties: { other: 'err' } }))

    assert.strictEqual(received.length, 2)
    assert.strictEqual(received[0].properties.other, 'value')
  })

  it('evicts oldest untriggered context when maxContexts exceeded', () => {
    const received: LogRecord[] = []
    const sink = fingersCrossed((r) => received.push(r), {
      isolation: propertyIsolation('requestId', { maxContexts: 2 }),
      afterTrigger: 'reset',
    })

    // Fill up 2 contexts
    sink(makeRecord('debug', { properties: { requestId: 'req-1', data: 'a' } }))
    sink(makeRecord('debug', { properties: { requestId: 'req-2', data: 'b' } }))

    // Third context evicts req-1 (oldest)
    sink(makeRecord('debug', { properties: { requestId: 'req-3', data: 'c' } }))

    // Triggering req-1 creates a new buffer (old one was evicted)
    sink(makeRecord('error', { properties: { requestId: 'req-1', data: 'err' } }))

    // Only the error itself, no buffered debug from req-1
    assert.strictEqual(received.length, 1)
    assert.strictEqual(received[0].properties.data, 'err')
  })

  it('LRU eviction prefers untriggered contexts', () => {
    const received: LogRecord[] = []
    const sink = fingersCrossed((r) => received.push(r), {
      isolation: propertyIsolation('requestId', { maxContexts: 2 }),
      afterTrigger: 'passthrough',
    })

    // req-1 gets triggered (becomes passthrough)
    sink(makeRecord('error', { properties: { requestId: 'req-1' } }))
    received.length = 0

    // req-2 is untriggered
    sink(makeRecord('debug', { properties: { requestId: 'req-2' } }))

    // req-3 should evict req-2 (untriggered), not req-1 (triggered)
    sink(makeRecord('debug', { properties: { requestId: 'req-3' } }))

    // req-1 should still be in passthrough
    sink(makeRecord('debug', { properties: { requestId: 'req-1' } }))
    assert.strictEqual(received.length, 1)
    assert.strictEqual(received[0].properties.requestId, 'req-1')
  })

  it('bufferSize applies per context', () => {
    const received: LogRecord[] = []
    const sink = fingersCrossed((r) => received.push(r), {
      isolation: propertyIsolation('requestId'),
      bufferSize: 2,
      afterTrigger: 'reset',
    })

    sink(makeRecord('debug', { properties: { requestId: 'req-1', id: 1 } }))
    sink(makeRecord('debug', { properties: { requestId: 'req-1', id: 2 } }))
    sink(makeRecord('debug', { properties: { requestId: 'req-1', id: 3 } })) // evicts id:1

    sink(makeRecord('error', { properties: { requestId: 'req-1' } }))

    // id:2 + id:3 + error = 3
    assert.strictEqual(received.length, 3)
    assert.strictEqual(received[0].properties.id, 2)
    assert.strictEqual(received[1].properties.id, 3)
  })
})
