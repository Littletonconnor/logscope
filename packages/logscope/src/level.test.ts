import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  logLevels,
  compareLogLevel,
  isLogLevel,
  parseLogLevel,
  getLogLevels,
} from './level.ts'
import type { LogLevel } from './level.ts'

describe('logLevels', () => {
  it('has six levels in severity order', () => {
    assert.deepStrictEqual(logLevels, [
      'trace',
      'debug',
      'info',
      'warning',
      'error',
      'fatal',
    ])
  })
})

describe('compareLogLevel', () => {
  it('returns 0 for equal levels', () => {
    for (const level of logLevels) {
      assert.strictEqual(compareLogLevel(level, level), 0)
    }
  })

  it('returns negative when a is less severe than b', () => {
    assert.ok(compareLogLevel('trace', 'fatal') < 0)
    assert.ok(compareLogLevel('debug', 'info') < 0)
    assert.ok(compareLogLevel('info', 'warning') < 0)
    assert.ok(compareLogLevel('warning', 'error') < 0)
    assert.ok(compareLogLevel('error', 'fatal') < 0)
  })

  it('returns positive when a is more severe than b', () => {
    assert.ok(compareLogLevel('fatal', 'trace') > 0)
    assert.ok(compareLogLevel('error', 'debug') > 0)
    assert.ok(compareLogLevel('warning', 'info') > 0)
  })

  it('maintains correct ordering across all pairs', () => {
    for (let i = 0; i < logLevels.length; i++) {
      for (let j = i + 1; j < logLevels.length; j++) {
        assert.ok(
          compareLogLevel(logLevels[i], logLevels[j]) < 0,
          `expected ${logLevels[i]} < ${logLevels[j]}`,
        )
        assert.ok(
          compareLogLevel(logLevels[j], logLevels[i]) > 0,
          `expected ${logLevels[j]} > ${logLevels[i]}`,
        )
      }
    }
  })
})

describe('isLogLevel', () => {
  it('returns true for valid levels', () => {
    for (const level of logLevels) {
      assert.strictEqual(isLogLevel(level), true)
    }
  })

  it('returns false for invalid strings', () => {
    assert.strictEqual(isLogLevel('INFO'), false)
    assert.strictEqual(isLogLevel('warn'), false)
    assert.strictEqual(isLogLevel('verbose'), false)
    assert.strictEqual(isLogLevel(''), false)
  })
})

describe('parseLogLevel', () => {
  it('parses valid levels (case-insensitive)', () => {
    assert.strictEqual(parseLogLevel('info'), 'info')
    assert.strictEqual(parseLogLevel('INFO'), 'info')
    assert.strictEqual(parseLogLevel('Warning'), 'warning')
    assert.strictEqual(parseLogLevel('FATAL'), 'fatal')
    assert.strictEqual(parseLogLevel('Trace'), 'trace')
  })

  it('throws on invalid input', () => {
    assert.throws(() => parseLogLevel('warn'), TypeError)
    assert.throws(() => parseLogLevel('verbose'), TypeError)
    assert.throws(() => parseLogLevel(''), TypeError)
  })
})

describe('getLogLevels', () => {
  it('returns a copy of the levels array', () => {
    const levels = getLogLevels()
    assert.deepStrictEqual(levels, [...logLevels])
  })

  it('mutating the result does not affect the original', () => {
    const levels = getLogLevels()
    levels[0] = 'mutated' as LogLevel
    assert.strictEqual(logLevels[0], 'trace')
  })
})
