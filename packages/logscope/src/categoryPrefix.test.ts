import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import { AsyncLocalStorage } from 'node:async_hooks'
import { configure, reset } from './config.ts'
import { createLogger, LoggerImpl, strongRefs } from './logger.ts'
import { withCategoryPrefix } from './context.ts'
import type { LogRecord } from './record.ts'
import type { Sink } from './sink.ts'

/**
 * Helper: resets the entire logger tree so tests don't interfere.
 */
function resetAll(): void {
  reset()
  const root = LoggerImpl.getRoot()
  root.resetDescendants()
  strongRefs.clear()
}

/**
 * Helper: creates a sink that captures records into an array.
 */
function captureSink(): { sink: Sink; records: LogRecord[] } {
  const records: LogRecord[] = []
  const sink: Sink = (record) => records.push(record)
  return { sink, records }
}

describe('withCategoryPrefix', () => {
  beforeEach(() => resetAll())

  it('prepends prefix to createLogger category', async () => {
    const { sink, records } = captureSink()

    await configure({
      sinks: { test: sink },
      loggers: [{ category: ['my-sdk', 'http'], sinks: ['test'] }],
      contextLocalStorage: new AsyncLocalStorage(),
    })

    withCategoryPrefix('my-sdk', () => {
      const log = createLogger('http')
      assert.deepStrictEqual(log.category, ['my-sdk', 'http'])
      log.info('request sent')
    })

    assert.strictEqual(records.length, 1)
    assert.deepStrictEqual(records[0].category, ['my-sdk', 'http'])
  })

  it('nested prefixes stack: inner appends to outer', async () => {
    const { sink, records } = captureSink()

    await configure({
      sinks: { test: sink },
      loggers: [{ category: ['sdk', 'internal', 'cache'], sinks: ['test'] }],
      contextLocalStorage: new AsyncLocalStorage(),
    })

    withCategoryPrefix('sdk', () => {
      withCategoryPrefix('internal', () => {
        const log = createLogger('cache')
        assert.deepStrictEqual(log.category, ['sdk', 'internal', 'cache'])
        log.info('cache hit')
      })
    })

    assert.strictEqual(records.length, 1)
    assert.deepStrictEqual(records[0].category, ['sdk', 'internal', 'cache'])
  })

  it('prefix does not leak outside the callback', async () => {
    const { sink, records } = captureSink()

    await configure({
      sinks: { test: sink },
      loggers: [
        { category: ['prefixed', 'http'], sinks: ['test'] },
        { category: 'http', sinks: ['test'] },
      ],
      contextLocalStorage: new AsyncLocalStorage(),
    })

    withCategoryPrefix('prefixed', () => {
      const log = createLogger('http')
      log.info('inside')
    })

    // Outside the prefix scope
    const log = createLogger('http')
    log.info('outside')

    assert.strictEqual(records.length, 2)
    assert.deepStrictEqual(records[0].category, ['prefixed', 'http'])
    assert.deepStrictEqual(records[1].category, ['http'])
  })

  it('without contextLocalStorage configured, callback runs without prefix', async () => {
    const { sink, records } = captureSink()

    await configure({
      sinks: { test: sink },
      loggers: [{ category: 'http', sinks: ['test'] }],
      // No contextLocalStorage!
    })

    withCategoryPrefix('my-sdk', () => {
      const log = createLogger('http')
      // No prefix applied — category is just ['http']
      assert.deepStrictEqual(log.category, ['http'])
      log.info('no prefix')
    })

    assert.strictEqual(records.length, 1)
    assert.deepStrictEqual(records[0].category, ['http'])
  })

  it('accepts array prefix', async () => {
    const { sink, records } = captureSink()

    await configure({
      sinks: { test: sink },
      loggers: [{ category: ['org', 'sdk', 'db'], sinks: ['test'] }],
      contextLocalStorage: new AsyncLocalStorage(),
    })

    withCategoryPrefix(['org', 'sdk'], () => {
      const log = createLogger('db')
      assert.deepStrictEqual(log.category, ['org', 'sdk', 'db'])
      log.info('query')
    })

    assert.strictEqual(records.length, 1)
    assert.deepStrictEqual(records[0].category, ['org', 'sdk', 'db'])
  })

  it('withContext inside withCategoryPrefix preserves both', async () => {
    const { sink, records } = captureSink()
    const { withContext } = await import('./context.ts')

    await configure({
      sinks: { test: sink },
      loggers: [{ category: ['sdk', 'http'], sinks: ['test'] }],
      contextLocalStorage: new AsyncLocalStorage(),
    })

    withCategoryPrefix('sdk', () => {
      withContext({ requestId: 'req_1' }, () => {
        const log = createLogger('http')
        assert.deepStrictEqual(log.category, ['sdk', 'http'])
        log.info('request')
      })
    })

    assert.strictEqual(records.length, 1)
    assert.deepStrictEqual(records[0].category, ['sdk', 'http'])
    assert.strictEqual(records[0].properties.requestId, 'req_1')
  })

  it('withCategoryPrefix inside withContext preserves both', async () => {
    const { sink, records } = captureSink()
    const { withContext } = await import('./context.ts')

    await configure({
      sinks: { test: sink },
      loggers: [{ category: ['sdk', 'http'], sinks: ['test'] }],
      contextLocalStorage: new AsyncLocalStorage(),
    })

    withContext({ requestId: 'req_2' }, () => {
      withCategoryPrefix('sdk', () => {
        const log = createLogger('http')
        assert.deepStrictEqual(log.category, ['sdk', 'http'])
        log.info('request')
      })
    })

    assert.strictEqual(records.length, 1)
    assert.deepStrictEqual(records[0].category, ['sdk', 'http'])
    assert.strictEqual(records[0].properties.requestId, 'req_2')
  })

  it('prefix does not appear in log record properties', async () => {
    const { sink, records } = captureSink()

    await configure({
      sinks: { test: sink },
      loggers: [{ category: ['sdk', 'http'], sinks: ['test'] }],
      contextLocalStorage: new AsyncLocalStorage(),
    })

    withCategoryPrefix('sdk', () => {
      const log = createLogger('http')
      log.info('test', { foo: 'bar' })
    })

    assert.strictEqual(records.length, 1)
    // The prefix Symbol key should NOT leak into properties
    const propKeys = Object.keys(records[0].properties)
    assert.deepStrictEqual(propKeys, ['foo'])
  })

  it('works with async callbacks', async () => {
    const { sink, records } = captureSink()

    await configure({
      sinks: { test: sink },
      loggers: [{ category: ['sdk', 'http'], sinks: ['test'] }],
      contextLocalStorage: new AsyncLocalStorage(),
    })

    await withCategoryPrefix('sdk', async () => {
      await Promise.resolve()
      const log = createLogger('http')
      assert.deepStrictEqual(log.category, ['sdk', 'http'])
      log.info('after await')
    })

    assert.strictEqual(records.length, 1)
    assert.deepStrictEqual(records[0].category, ['sdk', 'http'])
  })

  it('returns the callback return value', async () => {
    await configure({
      sinks: { test: () => {} },
      loggers: [{ category: 'app', sinks: ['test'] }],
      contextLocalStorage: new AsyncLocalStorage(),
    })

    const result = withCategoryPrefix('sdk', () => 42)
    assert.strictEqual(result, 42)
  })
})
