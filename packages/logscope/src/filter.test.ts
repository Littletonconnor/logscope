import { describe, it } from 'node:test'
import assert from 'node:assert'
import { getLevelFilter, toFilter } from './filter.ts'
import type { Filter } from './filter.ts'
import type { LogRecord } from './record.ts'
import type { LogLevel } from './level.ts'
import { logLevels } from './level.ts'

function makeRecord(level: LogLevel): LogRecord {
  return {
    category: ['test'],
    level,
    timestamp: Date.now(),
    message: ['test message'],
    rawMessage: 'test message',
    properties: {},
  }
}

describe('getLevelFilter', () => {
  it('accepts records at the specified level and above', () => {
    const filter = getLevelFilter('warning')
    assert.strictEqual(filter(makeRecord('warning')), true)
    assert.strictEqual(filter(makeRecord('error')), true)
    assert.strictEqual(filter(makeRecord('fatal')), true)
  })

  it('rejects records below the specified level', () => {
    const filter = getLevelFilter('warning')
    assert.strictEqual(filter(makeRecord('trace')), false)
    assert.strictEqual(filter(makeRecord('debug')), false)
    assert.strictEqual(filter(makeRecord('info')), false)
  })

  it('accepts everything when set to trace', () => {
    const filter = getLevelFilter('trace')
    for (const level of logLevels) {
      assert.strictEqual(
        filter(makeRecord(level)),
        true,
        `expected trace filter to accept ${level}`,
      )
    }
  })

  it('accepts only fatal when set to fatal', () => {
    const filter = getLevelFilter('fatal')
    for (const level of logLevels) {
      const expected = level === 'fatal'
      assert.strictEqual(
        filter(makeRecord(level)),
        expected,
        `expected fatal filter to ${expected ? 'accept' : 'reject'} ${level}`,
      )
    }
  })
})

describe('toFilter', () => {
  it('passes a function through unchanged', () => {
    const custom: Filter = (record) => record.level === 'info'
    const result = toFilter(custom)
    assert.strictEqual(result, custom)
  })

  it('converts null to a filter that rejects everything', () => {
    const filter = toFilter(null)
    for (const level of logLevels) {
      assert.strictEqual(
        filter(makeRecord(level)),
        false,
        `expected null filter to reject ${level}`,
      )
    }
  })

  it('converts a LogLevel string to a level filter', () => {
    const filter = toFilter('info')
    assert.strictEqual(filter(makeRecord('trace')), false)
    assert.strictEqual(filter(makeRecord('debug')), false)
    assert.strictEqual(filter(makeRecord('info')), true)
    assert.strictEqual(filter(makeRecord('warning')), true)
    assert.strictEqual(filter(makeRecord('error')), true)
    assert.strictEqual(filter(makeRecord('fatal')), true)
  })
})
