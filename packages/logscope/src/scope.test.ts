import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import { createLogger, LoggerImpl, strongRefs } from './logger.ts'
import { deepMerge } from './scope.ts'
import type { LogRecord } from './record.ts'
import type { Sink } from './sink.ts'

/**
 * Helper: resets the entire logger tree so tests don't interfere.
 */
function resetTree(): void {
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

// ---------------------------------------------------------------------------
// deepMerge
// ---------------------------------------------------------------------------

describe('deepMerge', () => {
  it('should merge flat objects', () => {
    const result = deepMerge({ a: 1 }, { b: 2 })
    assert.deepStrictEqual(result, { a: 1, b: 2 })
  })

  it('should let source values win for same keys', () => {
    const result = deepMerge({ x: 1 }, { x: 2 })
    assert.deepStrictEqual(result, { x: 2 })
  })

  it('should deep-merge nested objects', () => {
    const result = deepMerge(
      { user: { id: '1' } },
      { user: { name: 'Alice' } },
    )
    assert.deepStrictEqual(result, { user: { id: '1', name: 'Alice' } })
  })

  it('should let nested source values win', () => {
    const result = deepMerge(
      { user: { id: '1', plan: 'free' } },
      { user: { id: '2' } },
    )
    assert.deepStrictEqual(result, { user: { id: '2', plan: 'free' } })
  })

  it('should replace arrays (no concatenation)', () => {
    const result = deepMerge({ tags: [1, 2] }, { tags: [3] })
    assert.deepStrictEqual(result, { tags: [3] })
  })

  it('should skip null values in source', () => {
    const result = deepMerge({ a: 1 }, { a: null })
    assert.deepStrictEqual(result, { a: 1 })
  })

  it('should skip undefined values in source', () => {
    const result = deepMerge({ a: 1 }, { a: undefined })
    assert.deepStrictEqual(result, { a: 1 })
  })

  it('should not mutate the target', () => {
    const target = { a: 1, nested: { b: 2 } }
    deepMerge(target, { a: 99, nested: { c: 3 } })
    assert.deepStrictEqual(target, { a: 1, nested: { b: 2 } })
  })
})

// ---------------------------------------------------------------------------
// Scope – accumulation
// ---------------------------------------------------------------------------

describe('Scope', () => {
  beforeEach(() => resetTree())

  describe('set()', () => {
    it('should accumulate context across multiple calls', () => {
      const log = createLogger('test')
      const scope = log.scope()
      scope.set({ a: 1 })
      scope.set({ b: 2 })
      assert.deepStrictEqual(scope.getContext(), { a: 1, b: 2 })
    })

    it('should deep-merge nested objects', () => {
      const log = createLogger('test')
      const scope = log.scope()
      scope.set({ user: { id: '1' } })
      scope.set({ user: { name: 'Alice' } })
      assert.deepStrictEqual(scope.getContext(), {
        user: { id: '1', name: 'Alice' },
      })
    })

    it('should let new values win for same keys', () => {
      const log = createLogger('test')
      const scope = log.scope()
      scope.set({ x: 1 })
      scope.set({ x: 2 })
      assert.deepStrictEqual(scope.getContext(), { x: 2 })
    })
  })

  describe('getContext()', () => {
    it('should return a snapshot that does not mutate when set() is called', () => {
      const log = createLogger('test')
      const scope = log.scope()
      scope.set({ a: 1 })
      const snapshot = scope.getContext()
      scope.set({ a: 99, b: 2 })
      assert.deepStrictEqual(snapshot, { a: 1 })
    })
  })

  describe('emit()', () => {
    it('should produce one LogRecord with all accumulated data', () => {
      const { sink, records } = captureSink()
      const impl = LoggerImpl.getLogger(['test'])
      impl.sinks.push(sink)
      strongRefs.add(impl)

      const log = createLogger('test')
      const scope = log.scope()
      scope.set({ method: 'POST', path: '/checkout' })
      scope.set({ user: { id: '123' } })
      scope.emit()

      assert.strictEqual(records.length, 1)
      assert.strictEqual(records[0].properties.method, 'POST')
      assert.strictEqual(records[0].properties.path, '/checkout')
      assert.deepStrictEqual(records[0].properties.user, { id: '123' })
    })

    it('should include duration in properties', () => {
      const { sink, records } = captureSink()
      const impl = LoggerImpl.getLogger(['test'])
      impl.sinks.push(sink)
      strongRefs.add(impl)

      const log = createLogger('test')
      const scope = log.scope()
      scope.emit()

      assert.strictEqual(records.length, 1)
      assert.strictEqual(typeof records[0].properties.duration, 'number')
      assert.ok((records[0].properties.duration as number) >= 0)
    })

    it('should default to info level', () => {
      const { sink, records } = captureSink()
      const impl = LoggerImpl.getLogger(['test'])
      impl.sinks.push(sink)
      strongRefs.add(impl)

      const log = createLogger('test')
      const scope = log.scope()
      scope.emit()

      assert.strictEqual(records[0].level, 'info')
    })

    it('should be warning level when warn() was called', () => {
      const { sink, records } = captureSink()
      const impl = LoggerImpl.getLogger(['test'])
      impl.sinks.push(sink)
      strongRefs.add(impl)

      const log = createLogger('test')
      const scope = log.scope()
      scope.warn('slow query')
      scope.emit()

      assert.strictEqual(records[0].level, 'warning')
    })

    it('should be error level when error() was called', () => {
      const { sink, records } = captureSink()
      const impl = LoggerImpl.getLogger(['test'])
      impl.sinks.push(sink)
      strongRefs.add(impl)

      const log = createLogger('test')
      const scope = log.scope()
      scope.warn('something slow')
      scope.error(new Error('boom'))
      scope.emit()

      // error wins over warning
      assert.strictEqual(records[0].level, 'error')
    })

    it('should apply overrides', () => {
      const { sink, records } = captureSink()
      const impl = LoggerImpl.getLogger(['test'])
      impl.sinks.push(sink)
      strongRefs.add(impl)

      const log = createLogger('test')
      const scope = log.scope()
      scope.set({ status: 200 })
      scope.emit({ status: 500 })

      assert.strictEqual(records[0].properties.status, 500)
    })

    it('should be silent when logger is unconfigured', () => {
      const log = createLogger('unconfigured')
      const scope = log.scope()
      scope.set({ data: 'test' })
      // Should not throw
      assert.doesNotThrow(() => scope.emit())
    })

    it('should have the correct category', () => {
      const { sink, records } = captureSink()
      const impl = LoggerImpl.getLogger(['my-app', 'db'])
      impl.sinks.push(sink)
      strongRefs.add(impl)

      const log = createLogger(['my-app', 'db'])
      const scope = log.scope()
      scope.emit()

      assert.deepStrictEqual(records[0].category, ['my-app', 'db'])
    })
  })

  describe('error()', () => {
    it('should extract Error properties', () => {
      const { sink, records } = captureSink()
      const impl = LoggerImpl.getLogger(['test'])
      impl.sinks.push(sink)
      strongRefs.add(impl)

      const log = createLogger('test')
      const scope = log.scope()
      const err = new Error('payment failed')
      scope.error(err)
      scope.emit()

      const errorProp = records[0].properties.error as Record<string, unknown>
      assert.strictEqual(errorProp.name, 'Error')
      assert.strictEqual(errorProp.message, 'payment failed')
      assert.strictEqual(typeof errorProp.stack, 'string')
    })

    it('should handle string errors', () => {
      const { sink, records } = captureSink()
      const impl = LoggerImpl.getLogger(['test'])
      impl.sinks.push(sink)
      strongRefs.add(impl)

      const log = createLogger('test')
      const scope = log.scope()
      scope.error('something went wrong')
      scope.emit()

      const errorProp = records[0].properties.error as Record<string, unknown>
      assert.strictEqual(errorProp.message, 'something went wrong')
    })

    it('should extract Error.cause when present', () => {
      const { sink, records } = captureSink()
      const impl = LoggerImpl.getLogger(['test'])
      impl.sinks.push(sink)
      strongRefs.add(impl)

      const log = createLogger('test')
      const scope = log.scope()
      const cause = new Error('root cause')
      const err = new Error('wrapper', { cause })
      scope.error(err)
      scope.emit()

      const errorProp = records[0].properties.error as Record<string, unknown>
      assert.strictEqual(errorProp.cause, cause)
    })

    it('should merge additional context from error()', () => {
      const { sink, records } = captureSink()
      const impl = LoggerImpl.getLogger(['test'])
      impl.sinks.push(sink)
      strongRefs.add(impl)

      const log = createLogger('test')
      const scope = log.scope()
      scope.error('fail', { orderId: 'abc' })
      scope.emit()

      assert.strictEqual(records[0].properties.orderId, 'abc')
    })
  })

  describe('requestLogs', () => {
    it('should include requestLogs when sub-events are recorded', () => {
      const { sink, records } = captureSink()
      const impl = LoggerImpl.getLogger(['test'])
      impl.sinks.push(sink)
      strongRefs.add(impl)

      const log = createLogger('test')
      const scope = log.scope()
      scope.info('step 1')
      scope.info('step 2', { detail: 'extra' })
      scope.warn('slow')
      scope.emit()

      const logs = records[0].properties.requestLogs as Array<Record<string, unknown>>
      assert.strictEqual(logs.length, 3)
      assert.strictEqual(logs[0].message, 'step 1')
      assert.strictEqual(logs[0].level, 'info')
      assert.strictEqual(logs[1].message, 'step 2')
      assert.strictEqual(logs[2].message, 'slow')
      assert.strictEqual(logs[2].level, 'warning')
    })

    it('should not include requestLogs when no sub-events are recorded', () => {
      const { sink, records } = captureSink()
      const impl = LoggerImpl.getLogger(['test'])
      impl.sinks.push(sink)
      strongRefs.add(impl)

      const log = createLogger('test')
      const scope = log.scope()
      scope.set({ data: 'value' })
      scope.emit()

      assert.strictEqual(records[0].properties.requestLogs, undefined)
    })
  })

  describe('initial context', () => {
    it('should accept initial context in scope()', () => {
      const { sink, records } = captureSink()
      const impl = LoggerImpl.getLogger(['test'])
      impl.sinks.push(sink)
      strongRefs.add(impl)

      const log = createLogger('test')
      const scope = log.scope({ method: 'GET', path: '/' })
      scope.emit()

      assert.strictEqual(records[0].properties.method, 'GET')
      assert.strictEqual(records[0].properties.path, '/')
    })

    it('should merge set() on top of initial context', () => {
      const log = createLogger('test')
      const scope = log.scope({ method: 'GET' })
      scope.set({ method: 'POST' })
      assert.deepStrictEqual(scope.getContext(), { method: 'POST' })
    })
  })

  describe('.with() context inheritance', () => {
    it('should inherit .with() context from its parent logger', () => {
      const { sink, records } = captureSink()
      const impl = LoggerImpl.getLogger(['test'])
      impl.sinks.push(sink)
      strongRefs.add(impl)

      const log = createLogger('test')
      const reqLog = log.with({ requestId: 'req_abc' })
      const scope = reqLog.scope()
      scope.set({ action: 'checkout' })
      scope.emit()

      assert.strictEqual(records[0].properties.requestId, 'req_abc')
      assert.strictEqual(records[0].properties.action, 'checkout')
    })

    it('should allow scope data to override .with() context', () => {
      const { sink, records } = captureSink()
      const impl = LoggerImpl.getLogger(['test'])
      impl.sinks.push(sink)
      strongRefs.add(impl)

      const log = createLogger('test')
      const reqLog = log.with({ status: 'pending' })
      const scope = reqLog.scope()
      scope.set({ status: 'completed' })
      scope.emit()

      assert.strictEqual(records[0].properties.status, 'completed')
    })
  })

  describe('hierarchical dispatch', () => {
    it('should bubble up to parent sinks', () => {
      const { sink, records } = captureSink()
      const parentImpl = LoggerImpl.getLogger(['app'])
      parentImpl.sinks.push(sink)
      strongRefs.add(parentImpl)

      const log = createLogger(['app', 'db'])
      const scope = log.scope()
      scope.set({ query: 'SELECT *' })
      scope.emit()

      assert.strictEqual(records.length, 1)
      assert.strictEqual(records[0].properties.query, 'SELECT *')
      assert.deepStrictEqual(records[0].category, ['app', 'db'])
    })
  })
})
