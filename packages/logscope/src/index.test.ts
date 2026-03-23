import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert'

// Import everything from the public barrel — validates the export surface
import {
  // Level
  logLevels,
  compareLogLevel,
  isLogLevel,
  parseLogLevel,
  getLogLevels,
  // Filter
  getLevelFilter,
  toFilter,
  // Sink
  getConsoleSink,
  withFilter,
  // Formatter
  renderMessage,
  getTextFormatter,
  getJsonFormatter,
  getAnsiColorFormatter,
  // Logger
  createLogger,
  // Config
  configure,
  reset,
  dispose,
  isConfigured,
  ConfigError,
  // Context
  withContext,
} from './index.ts'

import type { LogRecord, Sink } from './index.ts'

/**
 * Helper: creates a sink that captures records into an array.
 */
function captureSink(): { sink: Sink; records: LogRecord[] } {
  const records: LogRecord[] = []
  const sink: Sink = (record) => records.push(record)
  return { sink, records }
}

describe('public API: all exports are accessible', () => {
  it('exports all level utilities', () => {
    assert.ok(Array.isArray(logLevels))
    assert.strictEqual(typeof compareLogLevel, 'function')
    assert.strictEqual(typeof isLogLevel, 'function')
    assert.strictEqual(typeof parseLogLevel, 'function')
    assert.strictEqual(typeof getLogLevels, 'function')
  })

  it('exports all filter utilities', () => {
    assert.strictEqual(typeof getLevelFilter, 'function')
    assert.strictEqual(typeof toFilter, 'function')
  })

  it('exports all sink utilities', () => {
    assert.strictEqual(typeof getConsoleSink, 'function')
    assert.strictEqual(typeof withFilter, 'function')
  })

  it('exports all formatter utilities', () => {
    assert.strictEqual(typeof renderMessage, 'function')
    assert.strictEqual(typeof getTextFormatter, 'function')
    assert.strictEqual(typeof getJsonFormatter, 'function')
    assert.strictEqual(typeof getAnsiColorFormatter, 'function')
  })

  it('exports logger factory', () => {
    assert.strictEqual(typeof createLogger, 'function')
  })

  it('exports config utilities', () => {
    assert.strictEqual(typeof configure, 'function')
    assert.strictEqual(typeof reset, 'function')
    assert.strictEqual(typeof dispose, 'function')
    assert.strictEqual(typeof isConfigured, 'function')
    assert.ok(ConfigError.prototype instanceof Error)
  })

  it('exports context utility', () => {
    assert.strictEqual(typeof withContext, 'function')
  })
})

describe('public API: does NOT export internals', () => {
  it('does not export LoggerImpl, LoggerCtx, deepMerge, or other internals', async () => {
    // Dynamic import to inspect the module's actual exports
    const mod = await import('./index.ts')
    const exportedKeys = Object.keys(mod)

    assert.ok(!exportedKeys.includes('LoggerImpl'), 'LoggerImpl should not be exported')
    assert.ok(!exportedKeys.includes('LoggerCtx'), 'LoggerCtx should not be exported')
    assert.ok(!exportedKeys.includes('DefaultLogger'), 'DefaultLogger should not be exported')
    assert.ok(!exportedKeys.includes('deepMerge'), 'deepMerge should not be exported')
    assert.ok(!exportedKeys.includes('strongRefs'), 'strongRefs should not be exported')
    assert.ok(!exportedKeys.includes('createScope'), 'createScope should not be exported')
    assert.ok(!exportedKeys.includes('getImplicitContext'), 'getImplicitContext should not be exported')
    assert.ok(!exportedKeys.includes('setContextLocalStorage'), 'setContextLocalStorage should not be exported')
    assert.ok(!exportedKeys.includes('clearContextLocalStorage'), 'clearContextLocalStorage should not be exported')
  })
})

describe('integration: full end-to-end via public API', () => {
  afterEach(() => reset())

  it('configure → createLogger → log → sink receives record', async () => {
    const { sink, records } = captureSink()

    await configure({
      sinks: { console: sink },
      loggers: [{ category: 'my-app', level: 'debug', sinks: ['console'] }],
    })

    const log = createLogger('my-app')
    log.info('user logged in', { userId: '123' })

    assert.strictEqual(records.length, 1)
    assert.deepStrictEqual(records[0].category, ['my-app'])
    assert.strictEqual(records[0].level, 'info')
    assert.strictEqual(records[0].rawMessage, 'user logged in')
    assert.strictEqual(records[0].properties.userId, '123')
    assert.ok(records[0].timestamp > 0)
  })

  it('child logger + .with() context + hierarchical dispatch', async () => {
    const { sink, records } = captureSink()

    await configure({
      sinks: { test: sink },
      loggers: [{ category: 'app', sinks: ['test'] }],
    })

    const log = createLogger('app')
    const reqLog = log.with({ requestId: 'req_abc' })
    const dbLog = reqLog.child('db')
    dbLog.info('query executed', { table: 'users', ms: 42 })

    assert.strictEqual(records.length, 1)
    assert.deepStrictEqual(records[0].category, ['app', 'db'])
    assert.strictEqual(records[0].properties.requestId, 'req_abc')
    assert.strictEqual(records[0].properties.table, 'users')
    assert.strictEqual(records[0].properties.ms, 42)
  })

  it('scoped wide events accumulate and emit once', async () => {
    const { sink, records } = captureSink()

    await configure({
      sinks: { test: sink },
      loggers: [{ category: 'app', sinks: ['test'] }],
    })

    const log = createLogger('app')
    const scope = log.scope({ method: 'POST', path: '/checkout' })
    scope.set({ user: { id: '123', plan: 'premium' } })
    scope.set({ cart: { items: 3, total: 99.99 } })
    scope.emit()

    assert.strictEqual(records.length, 1)
    assert.strictEqual(records[0].level, 'info')
    assert.strictEqual(records[0].properties.method, 'POST')
    assert.strictEqual(records[0].properties.path, '/checkout')
    assert.deepStrictEqual(records[0].properties.user, { id: '123', plan: 'premium' })
    assert.deepStrictEqual(records[0].properties.cart, { items: 3, total: 99.99 })
    assert.ok(typeof records[0].properties.duration === 'number')
  })

  it('formatters produce expected output from records', async () => {
    const { sink, records } = captureSink()

    await configure({
      sinks: { test: sink },
      loggers: [{ category: 'app', sinks: ['test'] }],
    })

    const log = createLogger('app')
    log.info('hello world', { key: 'val' })

    const record = records[0]
    const textFmt = getTextFormatter()
    const jsonFmt = getJsonFormatter()
    const ansiFmt = getAnsiColorFormatter()

    const text = textFmt(record)
    assert.ok(text.includes('hello world'))
    assert.ok(text.includes('app'))

    const json = jsonFmt(record)
    const parsed = JSON.parse(json)
    assert.strictEqual(parsed.level, 'INFO')
    assert.strictEqual(parsed.message, 'hello world')

    const ansi = ansiFmt(record)
    assert.ok(ansi.includes('\x1b['), 'should contain ANSI escape codes')
    assert.ok(ansi.includes('hello world'))
  })

  it('withFilter composes sink + filter via public API', async () => {
    const { sink, records } = captureSink()
    const warnFilter = getLevelFilter('warning')
    const filtered = withFilter(sink, warnFilter)

    await configure({
      sinks: { test: filtered },
      loggers: [{ category: 'app', sinks: ['test'] }],
    })

    const log = createLogger('app')
    log.info('should be blocked')
    log.warning('should pass')

    assert.strictEqual(records.length, 1)
    assert.strictEqual(records[0].rawMessage, 'should pass')
  })
})

describe('integration: library-first (unconfigured = silent)', () => {
  afterEach(() => reset())

  it('unconfigured logger produces zero output and zero errors', () => {
    const log = createLogger('my-library')

    assert.doesNotThrow(() => {
      log.trace('trace msg')
      log.debug('debug msg')
      log.info('info msg')
      log.warn('warn msg')
      log.warning('warning msg')
      log.error('error msg')
      log.fatal('fatal msg')
    })
  })

  it('unconfigured child loggers and .with() are silent', () => {
    const log = createLogger('my-library')

    assert.doesNotThrow(() => {
      const child = log.child('module')
      child.info('child msg')

      const ctx = log.with({ version: '1.0' })
      ctx.info('ctx msg')

      const childCtx = ctx.child('sub')
      childCtx.info('child ctx msg')
    })
  })

  it('unconfigured scope.emit() is silent', () => {
    const log = createLogger('my-library')

    assert.doesNotThrow(() => {
      const scope = log.scope({ method: 'GET' })
      scope.set({ path: '/api' })
      scope.emit()
    })
  })
})

describe('integration: dual ESM/CJS output', () => {
  it('package.json has correct exports map', async () => {
    const { readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')

    const pkgPath = join(import.meta.dirname, '..', 'package.json')
    const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'))

    // Exports map
    assert.ok(pkg.exports['.'], 'should have "." export')
    assert.ok(pkg.exports['.'].types, 'should have types export')
    assert.ok(pkg.exports['.'].import, 'should have ESM export')
    assert.ok(pkg.exports['.'].require, 'should have CJS export')

    // sideEffects
    assert.strictEqual(pkg.sideEffects, false, 'should be marked side-effect free')

    // files
    assert.ok(pkg.files.includes('dist'), 'should include dist in files')
  })
})
