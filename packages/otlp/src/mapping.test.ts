import { describe, it } from 'node:test'
import assert from 'node:assert'
import type { LogRecord } from 'logscope'
import {
  toAnyValue,
  toAttributes,
  toExportLogsServiceRequest,
  SeverityNumber,
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

describe('toAnyValue', () => {
  it('converts strings', () => {
    assert.deepStrictEqual(toAnyValue('hello'), { stringValue: 'hello' })
  })

  it('converts booleans', () => {
    assert.deepStrictEqual(toAnyValue(true), { boolValue: true })
    assert.deepStrictEqual(toAnyValue(false), { boolValue: false })
  })

  it('converts safe integers as intValue', () => {
    assert.deepStrictEqual(toAnyValue(42), { intValue: '42' })
    assert.deepStrictEqual(toAnyValue(0), { intValue: '0' })
    assert.deepStrictEqual(toAnyValue(-1), { intValue: '-1' })
  })

  it('converts floats as doubleValue', () => {
    assert.deepStrictEqual(toAnyValue(3.14), { doubleValue: 3.14 })
    assert.deepStrictEqual(toAnyValue(NaN), { doubleValue: NaN })
    assert.deepStrictEqual(toAnyValue(Infinity), { doubleValue: Infinity })
  })

  it('converts bigint as intValue', () => {
    assert.deepStrictEqual(toAnyValue(BigInt(999)), { intValue: '999' })
  })

  it('converts null and undefined as stringValue', () => {
    assert.deepStrictEqual(toAnyValue(null), { stringValue: 'null' })
    assert.deepStrictEqual(toAnyValue(undefined), { stringValue: 'undefined' })
  })

  it('converts arrays', () => {
    const result = toAnyValue([1, 'two', true])
    assert.deepStrictEqual(result, {
      arrayValue: {
        values: [{ intValue: '1' }, { stringValue: 'two' }, { boolValue: true }],
      },
    })
  })

  it('converts plain objects as kvlistValue', () => {
    const result = toAnyValue({ name: 'Alice', age: 30 })
    assert.deepStrictEqual(result, {
      kvlistValue: {
        values: [
          { key: 'name', value: { stringValue: 'Alice' } },
          { key: 'age', value: { intValue: '30' } },
        ],
      },
    })
  })

  it('converts Error objects with name, message, stack, cause', () => {
    const cause = new Error('root cause')
    const err = new Error('something broke')
    err.cause = cause

    const result = toAnyValue(err) as { kvlistValue: { values: Array<{ key: string; value: unknown }> } }
    assert.ok('kvlistValue' in result)
    const keys = result.kvlistValue.values.map((kv) => kv.key)
    assert.ok(keys.includes('name'))
    assert.ok(keys.includes('message'))
    assert.ok(keys.includes('stack'))
    assert.ok(keys.includes('cause'))
  })

  it('converts Date as ISO string', () => {
    const date = new Date('2024-01-15T10:30:00.000Z')
    assert.deepStrictEqual(toAnyValue(date), { stringValue: '2024-01-15T10:30:00.000Z' })
  })

  it('converts functions and symbols as stringValue', () => {
    const fn = function myFunc() {}
    const result = toAnyValue(fn)
    assert.ok('stringValue' in result)

    const sym = toAnyValue(Symbol('test'))
    assert.ok('stringValue' in sym)
  })
})

describe('toAttributes', () => {
  it('converts a properties object to OTLP KeyValue array', () => {
    const attrs = toAttributes({ userId: '123', count: 5 })
    assert.strictEqual(attrs.length, 2)
    assert.deepStrictEqual(attrs[0], { key: 'userId', value: { stringValue: '123' } })
    assert.deepStrictEqual(attrs[1], { key: 'count', value: { intValue: '5' } })
  })

  it('returns empty array for empty properties', () => {
    assert.deepStrictEqual(toAttributes({}), [])
  })
})

describe('toExportLogsServiceRequest', () => {
  it('produces valid OTLP JSON structure', () => {
    const record = makeRecord({ properties: { action: 'page_view' } })
    const result = toExportLogsServiceRequest([record])

    assert.strictEqual(result.resourceLogs.length, 1)
    assert.strictEqual(result.resourceLogs[0].scopeLogs.length, 1)
    assert.strictEqual(result.resourceLogs[0].scopeLogs[0].scope.name, 'my-app')
    assert.strictEqual(result.resourceLogs[0].scopeLogs[0].logRecords.length, 1)
  })

  it('maps severity correctly for each log level', () => {
    const levels: Array<{ level: LogRecord['level']; num: number; text: string }> = [
      { level: 'trace', num: SeverityNumber.TRACE, text: 'TRACE' },
      { level: 'debug', num: SeverityNumber.DEBUG, text: 'DEBUG' },
      { level: 'info', num: SeverityNumber.INFO, text: 'INFO' },
      { level: 'warning', num: SeverityNumber.WARN, text: 'WARN' },
      { level: 'error', num: SeverityNumber.ERROR, text: 'ERROR' },
      { level: 'fatal', num: SeverityNumber.FATAL, text: 'FATAL' },
    ]

    for (const { level, num, text } of levels) {
      const result = toExportLogsServiceRequest([makeRecord({ level })])
      const otlpRecord = result.resourceLogs[0].scopeLogs[0].logRecords[0]
      assert.strictEqual(otlpRecord.severityNumber, num, `severity number for ${level}`)
      assert.strictEqual(otlpRecord.severityText, text, `severity text for ${level}`)
    }
  })

  it('converts timestamp to nanoseconds string', () => {
    const record = makeRecord({ timestamp: 1700000000000 })
    const result = toExportLogsServiceRequest([record])
    const otlpRecord = result.resourceLogs[0].scopeLogs[0].logRecords[0]
    // 1700000000000 ms * 1e6 = 1.7e18 ns
    assert.strictEqual(otlpRecord.timeUnixNano, '1700000000000000000')
  })

  it('sets the body from the message array', () => {
    const record = makeRecord({ message: ['user ', 'Alice', ' logged in'] })
    const result = toExportLogsServiceRequest([record])
    const otlpRecord = result.resourceLogs[0].scopeLogs[0].logRecords[0]
    assert.deepStrictEqual(otlpRecord.body, { stringValue: 'user Alice logged in' })
  })

  it('includes properties as attributes', () => {
    const record = makeRecord({ properties: { userId: '123', duration: 42 } })
    const result = toExportLogsServiceRequest([record])
    const attrs = result.resourceLogs[0].scopeLogs[0].logRecords[0].attributes

    // First attribute is log.category, then properties
    const userIdAttr = attrs.find((a) => a.key === 'userId')
    assert.deepStrictEqual(userIdAttr?.value, { stringValue: '123' })
    const durationAttr = attrs.find((a) => a.key === 'duration')
    assert.deepStrictEqual(durationAttr?.value, { intValue: '42' })
  })

  it('includes log.category attribute', () => {
    const record = makeRecord({ category: ['my-app', 'db'] })
    const result = toExportLogsServiceRequest([record])
    const attrs = result.resourceLogs[0].scopeLogs[0].logRecords[0].attributes
    const catAttr = attrs.find((a) => a.key === 'log.category')
    assert.deepStrictEqual(catAttr?.value, {
      arrayValue: { values: [{ stringValue: 'my-app' }, { stringValue: 'db' }] },
    })
  })

  it('groups records by category into separate scopes', () => {
    const records = [
      makeRecord({ category: ['app', 'db'], properties: { table: 'users' } }),
      makeRecord({ category: ['app', 'http'], properties: { path: '/' } }),
      makeRecord({ category: ['app', 'db'], properties: { table: 'orders' } }),
    ]

    const result = toExportLogsServiceRequest(records)
    const scopeLogs = result.resourceLogs[0].scopeLogs

    assert.strictEqual(scopeLogs.length, 2)
    assert.strictEqual(scopeLogs[0].scope.name, 'app.db')
    assert.strictEqual(scopeLogs[0].logRecords.length, 2)
    assert.strictEqual(scopeLogs[1].scope.name, 'app.http')
    assert.strictEqual(scopeLogs[1].logRecords.length, 1)
  })

  it('includes resource attributes', () => {
    const record = makeRecord()
    const result = toExportLogsServiceRequest([record], {
      'service.name': 'my-api',
      'service.version': '1.0.0',
    })

    const resourceAttrs = result.resourceLogs[0].resource.attributes
    const serviceName = resourceAttrs.find((a) => a.key === 'service.name')
    assert.deepStrictEqual(serviceName?.value, { stringValue: 'my-api' })
    const serviceVersion = resourceAttrs.find((a) => a.key === 'service.version')
    assert.deepStrictEqual(serviceVersion?.value, { stringValue: '1.0.0' })
  })

  it('produces JSON.stringify-safe output', () => {
    const record = makeRecord({ properties: { nested: { deep: true } } })
    const result = toExportLogsServiceRequest([record])
    const json = JSON.stringify(result)
    assert.ok(json.length > 0)
    const parsed = JSON.parse(json)
    assert.ok(parsed.resourceLogs)
  })
})
