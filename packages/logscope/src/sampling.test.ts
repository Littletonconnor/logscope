import { describe, it } from 'node:test'
import assert from 'node:assert'
import { createSamplingFilter } from './sampling.ts'
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

describe('createSamplingFilter', () => {
  describe('head sampling', () => {
    it('keeps all records when no rates are specified', () => {
      const filter = createSamplingFilter()
      for (let i = 0; i < 100; i++) {
        assert.strictEqual(filter(makeRecord('info')), true)
      }
    })

    it('drops all records when rate is 0', () => {
      const filter = createSamplingFilter({
        rates: { info: 0 },
      })
      for (let i = 0; i < 100; i++) {
        assert.strictEqual(filter(makeRecord('info')), false)
      }
    })

    it('keeps all records when rate is 1', () => {
      const filter = createSamplingFilter({
        rates: { info: 1 },
      })
      for (let i = 0; i < 100; i++) {
        assert.strictEqual(filter(makeRecord('info')), true)
      }
    })

    it('samples probabilistically based on rate', () => {
      let callIndex = 0
      // Deterministic: alternate 0.3 and 0.7
      const filter = createSamplingFilter({
        rates: { debug: 0.5 },
        random: () => (callIndex++ % 2 === 0 ? 0.3 : 0.7),
      })

      const results: boolean[] = []
      for (let i = 0; i < 10; i++) {
        results.push(filter(makeRecord('debug')))
      }

      // 0.3 < 0.5 → true, 0.7 >= 0.5 → false, alternating
      assert.deepStrictEqual(results, [true, false, true, false, true, false, true, false, true, false])
    })

    it('applies rates per level independently', () => {
      const filter = createSamplingFilter({
        rates: { trace: 0, debug: 0, info: 1 },
        random: () => 0.5,
      })

      assert.strictEqual(filter(makeRecord('trace')), false)
      assert.strictEqual(filter(makeRecord('debug')), false)
      assert.strictEqual(filter(makeRecord('info')), true)
      // Unspecified levels default to rate 1
      assert.strictEqual(filter(makeRecord('warning')), true)
      assert.strictEqual(filter(makeRecord('error')), true)
    })
  })

  describe('tail sampling', () => {
    it('force-keeps records matching a tail condition', () => {
      const filter = createSamplingFilter({
        rates: { info: 0 }, // Would normally drop all info
        keepWhen: [(r) => (r.properties.status as number) >= 500],
      })

      // Status 500 → kept despite rate 0
      assert.strictEqual(
        filter(makeRecord('info', { properties: { status: 500 } })),
        true,
      )
      // Status 200 → dropped by rate 0
      assert.strictEqual(
        filter(makeRecord('info', { properties: { status: 200 } })),
        false,
      )
    })

    it('supports multiple tail conditions (any match keeps)', () => {
      const filter = createSamplingFilter({
        rates: { info: 0 },
        keepWhen: [
          (r) => (r.properties.status as number) >= 500,
          (r) => (r.properties.duration as number) >= 1000,
        ],
      })

      // First condition matches
      assert.strictEqual(
        filter(makeRecord('info', { properties: { status: 503, duration: 50 } })),
        true,
      )
      // Second condition matches
      assert.strictEqual(
        filter(makeRecord('info', { properties: { status: 200, duration: 2000 } })),
        true,
      )
      // Neither matches
      assert.strictEqual(
        filter(makeRecord('info', { properties: { status: 200, duration: 50 } })),
        false,
      )
    })

    it('is checked before head sampling', () => {
      let headSamplingCalled = false
      const filter = createSamplingFilter({
        rates: { info: 0.5 },
        keepWhen: [(r) => r.properties.important === true],
        random: () => {
          headSamplingCalled = true
          return 0.99 // Would fail 0.5 rate
        },
      })

      // Tail condition matches → should not consult random()
      headSamplingCalled = false
      const result = filter(makeRecord('info', { properties: { important: true } }))
      assert.strictEqual(result, true)
      assert.strictEqual(headSamplingCalled, false)
    })
  })

  describe('combined head + tail sampling', () => {
    it('tail keeps override head drops', () => {
      const filter = createSamplingFilter({
        rates: { error: 0 },
        keepWhen: [(r) => r.properties.critical === true],
      })

      // Rate 0 would drop, but tail condition keeps
      assert.strictEqual(
        filter(makeRecord('error', { properties: { critical: true } })),
        true,
      )
      // Rate 0 drops when tail doesn't match
      assert.strictEqual(
        filter(makeRecord('error', { properties: { critical: false } })),
        false,
      )
    })

    it('works as a standard Filter with withFilter', () => {
      // Just verify it returns a boolean and is callable as Filter
      const filter = createSamplingFilter({ rates: { trace: 0.5 } })
      const result = filter(makeRecord('trace'))
      assert.strictEqual(typeof result, 'boolean')
    })
  })
})
