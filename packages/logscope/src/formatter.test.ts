import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  renderMessage,
  getTextFormatter,
  getJsonFormatter,
  getAnsiColorFormatter,
  getPrettyFormatter,
  getAutoFormatter,
} from './formatter.ts'
import type { LogRecord } from './record.ts'
import type { LogLevel } from './level.ts'

function makeRecord(
  level: LogLevel,
  overrides?: Partial<LogRecord>,
): LogRecord {
  return {
    category: ['test'],
    level,
    timestamp: new Date('2024-01-15T10:30:00.000Z').getTime(),
    message: ['test message'],
    rawMessage: 'test message',
    properties: {},
    ...overrides,
  }
}

describe('renderMessage', () => {
  it('renders a simple string message', () => {
    const record = makeRecord('info', {
      message: ['hello world'],
      rawMessage: 'hello world',
    })
    assert.strictEqual(renderMessage(record), 'hello world')
  })

  it('renders interleaved string/value parts', () => {
    const record = makeRecord('info', {
      message: ['Hello ', 'Alice', ', you have ', 42, ' items'],
      rawMessage: 'Hello {}, you have {} items',
    })
    const result = renderMessage(record)
    assert.strictEqual(result, 'Hello Alice, you have 42 items')
  })

  it('returns rawMessage when message array is empty', () => {
    const record = makeRecord('info', {
      message: [],
      rawMessage: 'fallback message',
    })
    assert.strictEqual(renderMessage(record), 'fallback message')
  })

  it('inspects non-string values at odd indices', () => {
    const record = makeRecord('info', {
      message: ['obj: ', { foo: 'bar' }, ''],
      rawMessage: 'obj: {}',
    })
    const result = renderMessage(record)
    assert.ok(result.includes('foo'))
    assert.ok(result.includes('bar'))
  })
})

describe('getTextFormatter', () => {
  it('produces expected format with all components', () => {
    const formatter = getTextFormatter()
    const record = makeRecord('info', {
      category: ['my-app', 'db'],
      message: ['query executed'],
      rawMessage: 'query executed',
      properties: { table: 'users', ms: 42 },
    })
    const output = formatter(record)
    assert.ok(output.includes('2024-01-15T10:30:00.000Z'))
    assert.ok(output.includes('[INFO]'))
    assert.ok(output.includes('my-app \u00b7 db'))
    assert.ok(output.includes('query executed'))
    assert.ok(output.includes('table:'))
    assert.ok(output.includes('users'))
    assert.ok(output.includes('ms: 42'))
  })

  it('handles records with no message (properties-only)', () => {
    const formatter = getTextFormatter()
    const record = makeRecord('info', {
      message: [],
      rawMessage: '',
      properties: { action: 'page_view' },
    })
    const output = formatter(record)
    assert.ok(output.includes('[INFO]'))
    assert.ok(output.includes('action:'))
    assert.ok(output.includes('page_view'))
    // No colon before properties when message is empty
    assert.ok(!output.includes(': {'))
  })

  it('handles records with no properties', () => {
    const formatter = getTextFormatter()
    const record = makeRecord('info', {
      message: ['just a message'],
      rawMessage: 'just a message',
      properties: {},
    })
    const output = formatter(record)
    assert.ok(output.includes('just a message'))
    assert.ok(!output.includes('{'))
  })

  it('respects custom category separator', () => {
    const formatter = getTextFormatter({ categorySeparator: '.' })
    const record = makeRecord('info', {
      category: ['my-app', 'db'],
    })
    const output = formatter(record)
    assert.ok(output.includes('my-app.db'))
  })

  it('respects timestamp: false option', () => {
    const formatter = getTextFormatter({ timestamp: false })
    const record = makeRecord('info')
    const output = formatter(record)
    assert.ok(!output.includes('2024-01-15'))
    assert.ok(output.startsWith('[INFO]'))
  })
})

describe('getJsonFormatter', () => {
  it('produces valid JSON', () => {
    const formatter = getJsonFormatter()
    const record = makeRecord('info', {
      category: ['my-app', 'db'],
      message: ['query executed'],
      rawMessage: 'query executed',
      properties: { table: 'users', ms: 42 },
    })
    const output = formatter(record)
    const parsed = JSON.parse(output)
    assert.strictEqual(parsed['@timestamp'], '2024-01-15T10:30:00.000Z')
    assert.strictEqual(parsed.level, 'INFO')
    assert.strictEqual(parsed.logger, 'my-app.db')
    assert.strictEqual(parsed.message, 'query executed')
    assert.strictEqual(parsed.properties.table, 'users')
    assert.strictEqual(parsed.properties.ms, 42)
  })

  it('serializes Error objects with name/message/stack/cause', () => {
    const cause = new Error('root cause')
    const err = new Error('something failed')
    err.cause = cause
    const formatter = getJsonFormatter()
    const record = makeRecord('error', {
      properties: { error: err },
    })
    const output = formatter(record)
    const parsed = JSON.parse(output)
    assert.strictEqual(parsed.properties.error.name, 'Error')
    assert.strictEqual(parsed.properties.error.message, 'something failed')
    assert.ok(typeof parsed.properties.error.stack === 'string')
    assert.strictEqual(parsed.properties.error.cause.name, 'Error')
    assert.strictEqual(parsed.properties.error.cause.message, 'root cause')
  })

  it('omits message when empty', () => {
    const formatter = getJsonFormatter()
    const record = makeRecord('info', {
      message: [],
      rawMessage: '',
    })
    const output = formatter(record)
    const parsed = JSON.parse(output)
    assert.strictEqual(parsed.message, undefined)
  })

  it('omits properties when empty', () => {
    const formatter = getJsonFormatter()
    const record = makeRecord('info', {
      properties: {},
    })
    const output = formatter(record)
    const parsed = JSON.parse(output)
    assert.strictEqual(parsed.properties, undefined)
  })

  it('respects custom category separator', () => {
    const formatter = getJsonFormatter({ categorySeparator: '/' })
    const record = makeRecord('info', {
      category: ['my-app', 'db'],
    })
    const output = formatter(record)
    const parsed = JSON.parse(output)
    assert.strictEqual(parsed.logger, 'my-app/db')
  })
})

describe('getAnsiColorFormatter', () => {
  it('includes ANSI escape codes', () => {
    const formatter = getAnsiColorFormatter()
    const record = makeRecord('info', {
      category: ['my-app'],
      message: ['hello'],
      rawMessage: 'hello',
    })
    const output = formatter(record)
    // Should contain escape codes
    assert.ok(output.includes('\x1b['))
  })

  it('includes dim timestamp', () => {
    const formatter = getAnsiColorFormatter()
    const record = makeRecord('info')
    const output = formatter(record)
    // DIM code is \x1b[2m
    assert.ok(output.includes('\x1b[2m'))
    assert.ok(output.includes('2024-01-15T10:30:00.000Z'))
  })

  it('includes bold category', () => {
    const formatter = getAnsiColorFormatter()
    const record = makeRecord('info', {
      category: ['my-app'],
    })
    const output = formatter(record)
    // BOLD code is \x1b[1m
    assert.ok(output.includes('\x1b[1m'))
    assert.ok(output.includes('my-app'))
  })

  it('uses green for info level', () => {
    const formatter = getAnsiColorFormatter()
    const record = makeRecord('info')
    const output = formatter(record)
    // GREEN is \x1b[32m
    assert.ok(output.includes('\x1b[32m'))
  })

  it('uses red for error level', () => {
    const formatter = getAnsiColorFormatter()
    const record = makeRecord('error')
    const output = formatter(record)
    // RED is \x1b[31m
    assert.ok(output.includes('\x1b[31m'))
  })

  it('uses yellow for warning level', () => {
    const formatter = getAnsiColorFormatter()
    const record = makeRecord('warning')
    const output = formatter(record)
    // YELLOW is \x1b[33m
    assert.ok(output.includes('\x1b[33m'))
  })

  it('uses gray for trace level', () => {
    const formatter = getAnsiColorFormatter()
    const record = makeRecord('trace')
    const output = formatter(record)
    // GRAY is \x1b[90m
    assert.ok(output.includes('\x1b[90m'))
  })

  it('includes properties in dim', () => {
    const formatter = getAnsiColorFormatter()
    const record = makeRecord('info', {
      properties: { key: 'value' },
    })
    const output = formatter(record)
    assert.ok(output.includes('key:'))
    assert.ok(output.includes('value'))
  })
})

describe('getPrettyFormatter', () => {
  it('renders header with colored level, bold category, and dim timestamp', () => {
    const formatter = getPrettyFormatter()
    const record = makeRecord('info', {
      category: ['my-app', 'db'],
      message: ['query executed'],
      rawMessage: 'query executed',
      properties: {},
    })
    const output = formatter(record)
    // Green for INFO
    assert.ok(output.includes('\x1b[32m'))
    // Bold for category
    assert.ok(output.includes('\x1b[1m'))
    // Dim for timestamp
    assert.ok(output.includes('\x1b[2m'))
    assert.ok(output.includes('INFO'))
    assert.ok(output.includes('my-app'))
    assert.ok(output.includes('query executed'))
  })

  it('renders small primitive property sets inline', () => {
    const formatter = getPrettyFormatter()
    const record = makeRecord('info', {
      message: ['hello'],
      rawMessage: 'hello',
      properties: { status: 200, path: '/home' },
    })
    const output = formatter(record)
    // Inline format: key=value on one line, no tree characters
    assert.ok(output.includes('status='))
    assert.ok(output.includes('200'))
    assert.ok(output.includes('path='))
    assert.ok(output.includes('/home'))
    assert.ok(!output.includes('├'))
    assert.ok(!output.includes('└'))
  })

  it('renders nested objects as a tree with box-drawing characters', () => {
    const formatter = getPrettyFormatter()
    const record = makeRecord('info', {
      properties: {
        user: { id: '123', name: 'Alice' },
        request: { method: 'POST', path: '/checkout' },
      },
    })
    const output = formatter(record)
    assert.ok(output.includes('├── ') || output.includes('└── '))
    assert.ok(output.includes('user:'))
    assert.ok(output.includes('id:'))
    assert.ok(output.includes('123'))
    assert.ok(output.includes('Alice'))
    assert.ok(output.includes('request:'))
  })

  it('uses └── for the last item in a group', () => {
    const formatter = getPrettyFormatter()
    const record = makeRecord('info', {
      properties: {
        a: { x: 1 },
        b: { y: 2 },
      },
    })
    const output = formatter(record)
    // Last top-level key should use └──
    assert.ok(output.includes('└── '))
  })

  it('uses ├── for non-last items', () => {
    const formatter = getPrettyFormatter()
    const record = makeRecord('info', {
      properties: {
        a: { x: 1 },
        b: { y: 2 },
      },
    })
    const output = formatter(record)
    assert.ok(output.includes('├── '))
  })

  it('respects maxDepth option', () => {
    const formatter = getPrettyFormatter({ maxDepth: 1 })
    const record = makeRecord('info', {
      properties: {
        deep: { nested: { very: { deep: 'value' } } },
      },
    })
    const output = formatter(record)
    // At maxDepth=1, 'deep' expands but 'nested' should be rendered as a leaf
    assert.ok(output.includes('nested:'))
    // 'very' should NOT be expanded as a separate tree branch
    const lines = output.split('\n')
    const veryLine = lines.find((l) => l.includes('very'))
    // 'very' appears as part of inspected object, not as its own tree node
    assert.ok(veryLine === undefined || !veryLine.includes('├── ') || veryLine.includes('nested:'))
  })

  it('renders wide event (scope-like) with duration and requestLogs', () => {
    const formatter = getPrettyFormatter()
    const record = makeRecord('info', {
      category: ['my-app'],
      properties: {
        user: { id: '123', plan: 'premium' },
        cart: { items: 3, total: 99.99 },
        duration: 42,
        requestLogs: [
          { level: 'info', message: 'checkout started', timestamp: Date.now() },
        ],
      },
    })
    const output = formatter(record)
    // Should be multi-line tree output
    const lines = output.split('\n')
    assert.ok(lines.length > 1, 'should be multi-line')
    assert.ok(output.includes('user:'))
    assert.ok(output.includes('cart:'))
    assert.ok(output.includes('duration:'))
  })

  it('colors error level red', () => {
    const formatter = getPrettyFormatter()
    const record = makeRecord('error', { properties: {} })
    const output = formatter(record)
    // RED is \x1b[31m
    assert.ok(output.includes('\x1b[31m'))
    assert.ok(output.includes('ERROR'))
  })

  it('colors warning level yellow', () => {
    const formatter = getPrettyFormatter()
    const record = makeRecord('warning', { properties: {} })
    const output = formatter(record)
    assert.ok(output.includes('\x1b[33m'))
    assert.ok(output.includes('WARNING'))
  })
})

describe('getAutoFormatter', () => {
  it('returns pretty formatter when production is false', () => {
    const formatter = getAutoFormatter({ production: false })
    const record = makeRecord('info', {
      category: ['app'],
      message: ['hello'],
      rawMessage: 'hello',
      properties: { nested: { key: 'val' } },
    })
    const output = formatter(record)
    // Pretty formatter uses ANSI codes and tree characters for nested objects
    assert.ok(output.includes('\x1b['), 'should contain ANSI codes')
  })

  it('returns JSON formatter when production is true', () => {
    const formatter = getAutoFormatter({ production: true })
    const record = makeRecord('info', {
      category: ['app'],
      message: ['hello'],
      rawMessage: 'hello',
      properties: { key: 'val' },
    })
    const output = formatter(record)
    // JSON formatter produces parseable JSON
    const parsed = JSON.parse(output)
    assert.strictEqual(parsed.level, 'INFO')
    assert.strictEqual(parsed.message, 'hello')
  })

  it('defaults to dev (pretty) when NODE_ENV is not production', () => {
    const original = process.env.NODE_ENV
    try {
      process.env.NODE_ENV = 'development'
      const formatter = getAutoFormatter()
      const record = makeRecord('info', {
        category: ['app'],
        message: ['test'],
        rawMessage: 'test',
        properties: {},
      })
      const output = formatter(record)
      assert.ok(output.includes('\x1b['), 'should be pretty (ANSI) output')
    } finally {
      process.env.NODE_ENV = original
    }
  })

  it('uses JSON when NODE_ENV is production', () => {
    const original = process.env.NODE_ENV
    try {
      process.env.NODE_ENV = 'production'
      const formatter = getAutoFormatter()
      const record = makeRecord('info', {
        category: ['app'],
        message: ['test'],
        rawMessage: 'test',
        properties: {},
      })
      const output = formatter(record)
      const parsed = JSON.parse(output)
      assert.strictEqual(parsed.level, 'INFO')
    } finally {
      process.env.NODE_ENV = original
    }
  })

  it('forwards pretty options in dev mode', () => {
    const formatter = getAutoFormatter({
      production: false,
      pretty: { categorySeparator: '.' },
    })
    const record = makeRecord('info', {
      category: ['my-app', 'db'],
      properties: {},
    })
    const output = formatter(record)
    assert.ok(output.includes('my-app.db'))
  })

  it('forwards json options in prod mode', () => {
    const formatter = getAutoFormatter({
      production: true,
      json: { categorySeparator: '/' },
    })
    const record = makeRecord('info', {
      category: ['my-app', 'db'],
      properties: {},
    })
    const output = formatter(record)
    const parsed = JSON.parse(output)
    assert.strictEqual(parsed.logger, 'my-app/db')
  })
})
