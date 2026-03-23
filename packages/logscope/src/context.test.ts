import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import { AsyncLocalStorage } from 'node:async_hooks'
import { configure, reset } from './config.ts'
import { createLogger, LoggerImpl, strongRefs } from './logger.ts'
import { withContext } from './context.ts'
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

describe('withContext', () => {
  beforeEach(() => resetAll())

  it('injects properties into all logs within callback scope', async () => {
    const { sink, records } = captureSink()

    await configure({
      sinks: { test: sink },
      loggers: [{ category: 'app', sinks: ['test'] }],
      contextLocalStorage: new AsyncLocalStorage(),
    })

    const log = createLogger('app')

    withContext({ requestId: 'req_abc' }, () => {
      log.info('handling request')
    })

    assert.strictEqual(records.length, 1)
    assert.strictEqual(records[0].properties.requestId, 'req_abc')
  })

  it('nested withContext calls: inner overrides outer for same keys', async () => {
    const { sink, records } = captureSink()

    await configure({
      sinks: { test: sink },
      loggers: [{ category: 'app', sinks: ['test'] }],
      contextLocalStorage: new AsyncLocalStorage(),
    })

    const log = createLogger('app')

    withContext({ requestId: 'outer', userId: 'user_1' }, () => {
      withContext({ requestId: 'inner' }, () => {
        log.info('nested')
      })
    })

    assert.strictEqual(records.length, 1)
    // Inner overrides outer for requestId
    assert.strictEqual(records[0].properties.requestId, 'inner')
    // userId inherited from outer
    assert.strictEqual(records[0].properties.userId, 'user_1')
  })

  it('context priority: message props > explicit .with() > implicit withContext', async () => {
    const { sink, records } = captureSink()

    await configure({
      sinks: { test: sink },
      loggers: [{ category: 'app', sinks: ['test'] }],
      contextLocalStorage: new AsyncLocalStorage(),
    })

    const log = createLogger('app')
    const logWithCtx = log.with({ source: 'explicit', userId: 'with_user' })

    withContext({ source: 'implicit', requestId: 'req_1', userId: 'ctx_user' }, () => {
      logWithCtx.info('test', { source: 'message' })
    })

    assert.strictEqual(records.length, 1)
    // Message props win over all
    assert.strictEqual(records[0].properties.source, 'message')
    // Explicit .with() wins over implicit
    assert.strictEqual(records[0].properties.userId, 'with_user')
    // Implicit context fills in the rest
    assert.strictEqual(records[0].properties.requestId, 'req_1')
  })

  it('without contextLocalStorage configured, withContext runs callback normally', async () => {
    const { sink, records } = captureSink()

    await configure({
      sinks: { test: sink },
      loggers: [{ category: 'app', sinks: ['test'] }],
      // No contextLocalStorage!
    })

    const log = createLogger('app')

    // Should not crash, callback should run, but no context attached
    const result = withContext({ requestId: 'req_abc' }, () => {
      log.info('no implicit context')
      return 42
    })

    assert.strictEqual(result, 42)
    assert.strictEqual(records.length, 1)
    assert.strictEqual(records[0].properties.requestId, undefined)
  })

  it('context does not leak across withContext boundaries', async () => {
    const { sink, records } = captureSink()

    await configure({
      sinks: { test: sink },
      loggers: [{ category: 'app', sinks: ['test'] }],
      contextLocalStorage: new AsyncLocalStorage(),
    })

    const log = createLogger('app')

    withContext({ requestId: 'req_1' }, () => {
      log.info('inside')
    })

    // Outside the withContext boundary
    log.info('outside')

    assert.strictEqual(records.length, 2)
    assert.strictEqual(records[0].properties.requestId, 'req_1')
    assert.strictEqual(records[1].properties.requestId, undefined)
  })

  it('scope inside withContext inherits the implicit context', async () => {
    const { sink, records } = captureSink()

    await configure({
      sinks: { test: sink },
      loggers: [{ category: 'app', sinks: ['test'] }],
      contextLocalStorage: new AsyncLocalStorage(),
    })

    const log = createLogger('app')

    withContext({ requestId: 'req_abc' }, () => {
      const scope = log.scope({ method: 'POST' })
      scope.set({ path: '/checkout' })
      scope.emit()
    })

    assert.strictEqual(records.length, 1)
    // Scope emits through logger, which picks up implicit context
    assert.strictEqual(records[0].properties.requestId, 'req_abc')
    assert.strictEqual(records[0].properties.method, 'POST')
    assert.strictEqual(records[0].properties.path, '/checkout')
  })

  it('withContext works with async callbacks', async () => {
    const { sink, records } = captureSink()

    await configure({
      sinks: { test: sink },
      loggers: [{ category: 'app', sinks: ['test'] }],
      contextLocalStorage: new AsyncLocalStorage(),
    })

    const log = createLogger('app')

    await withContext({ requestId: 'req_async' }, async () => {
      await Promise.resolve()
      log.info('after await')
    })

    assert.strictEqual(records.length, 1)
    assert.strictEqual(records[0].properties.requestId, 'req_async')
  })

  it('withContext returns the callback return value', async () => {
    await configure({
      sinks: { test: () => {} },
      loggers: [{ category: 'app', sinks: ['test'] }],
      contextLocalStorage: new AsyncLocalStorage(),
    })

    const result = withContext({ requestId: 'req_1' }, () => {
      return 'hello'
    })

    assert.strictEqual(result, 'hello')
  })

  it('reset clears context storage so withContext stops injecting', async () => {
    const { sink, records } = captureSink()

    await configure({
      sinks: { test: sink },
      loggers: [{ category: 'app', sinks: ['test'] }],
      contextLocalStorage: new AsyncLocalStorage(),
    })

    reset()

    // Re-configure without contextLocalStorage
    await configure({
      sinks: { test: sink },
      loggers: [{ category: 'app', sinks: ['test'] }],
    })

    const log = createLogger('app')

    withContext({ requestId: 'should_not_appear' }, () => {
      log.info('after reset')
    })

    assert.strictEqual(records.length, 1)
    assert.strictEqual(records[0].properties.requestId, undefined)
  })
})
