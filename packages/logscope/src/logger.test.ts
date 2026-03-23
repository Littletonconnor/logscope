import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import { createLogger, LoggerImpl, strongRefs } from './logger.ts'
import type { Logger } from './logger.ts'
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

describe('createLogger', () => {
  beforeEach(() => resetTree())

  it('should produce no output when unconfigured', () => {
    const log = createLogger('test')
    // These should not throw or produce any output
    log.trace('silent')
    log.debug('silent')
    log.info('silent')
    log.warn('silent')
    log.warning('silent')
    log.error('silent')
    log.fatal('silent')
  })

  it('should not throw when unconfigured', () => {
    const log = createLogger('test')
    assert.doesNotThrow(() => {
      log.info('hello')
      log.error('world')
      log.info({ key: 'value' })
    })
  })

  it('should accept a string category', () => {
    const log = createLogger('my-app')
    assert.deepStrictEqual(log.category, ['my-app'])
  })

  it('should accept an array category', () => {
    const log = createLogger(['my-app', 'db'])
    assert.deepStrictEqual(log.category, ['my-app', 'db'])
  })

  it('multiple calls with same category share same tree node', () => {
    const log1 = createLogger('shared')
    const log2 = createLogger('shared')

    // Both should share the same LoggerImpl – verify by attaching a sink
    // to the impl and checking both loggers dispatch to it
    const impl = LoggerImpl.getLogger(['shared'])
    const { sink, records } = captureSink()
    impl.sinks.push(sink)

    log1.info('from log1')
    log2.info('from log2')

    assert.strictEqual(records.length, 2)
    assert.strictEqual(records[0].rawMessage, 'from log1')
    assert.strictEqual(records[1].rawMessage, 'from log2')

    impl.sinks.length = 0
  })
})

describe('Logger dispatch', () => {
  beforeEach(() => resetTree())

  it('dispatches records to sinks attached to its tree node', () => {
    const impl = LoggerImpl.getLogger(['app'])
    const { sink, records } = captureSink()
    impl.sinks.push(sink)

    const log = createLogger('app')
    log.info('hello world')

    assert.strictEqual(records.length, 1)
    assert.deepStrictEqual(records[0].category, ['app'])
    assert.strictEqual(records[0].level, 'info')
    assert.strictEqual(records[0].rawMessage, 'hello world')
    assert.deepStrictEqual(records[0].message, ['hello world'])
  })

  it('dispatches with string message and properties', () => {
    const impl = LoggerImpl.getLogger(['app'])
    const { sink, records } = captureSink()
    impl.sinks.push(sink)

    const log = createLogger('app')
    log.info('user logged in', { userId: '123' })

    assert.strictEqual(records.length, 1)
    assert.strictEqual(records[0].rawMessage, 'user logged in')
    assert.strictEqual(records[0].properties.userId, '123')
  })

  it('dispatches with properties-only (no message)', () => {
    const impl = LoggerImpl.getLogger(['app'])
    const { sink, records } = captureSink()
    impl.sinks.push(sink)

    const log = createLogger('app')
    log.info({ action: 'page_view', path: '/home' })

    assert.strictEqual(records.length, 1)
    assert.deepStrictEqual(records[0].message, [])
    assert.strictEqual(records[0].rawMessage, '')
    assert.strictEqual(records[0].properties.action, 'page_view')
    assert.strictEqual(records[0].properties.path, '/home')
  })

  it('warn is an alias for warning', () => {
    const impl = LoggerImpl.getLogger(['app'])
    const { sink, records } = captureSink()
    impl.sinks.push(sink)

    const log = createLogger('app')
    log.warn('slow query', { duration: 1200 })

    assert.strictEqual(records.length, 1)
    assert.strictEqual(records[0].level, 'warning')
  })

  it('records have a timestamp', () => {
    const impl = LoggerImpl.getLogger(['app'])
    const { sink, records } = captureSink()
    impl.sinks.push(sink)

    const before = Date.now()
    const log = createLogger('app')
    log.info('test')
    const after = Date.now()

    assert.ok(records[0].timestamp >= before)
    assert.ok(records[0].timestamp <= after)
  })
})

describe('child loggers', () => {
  beforeEach(() => resetTree())

  it('child has correct category', () => {
    const log = createLogger('app')
    const child = log.child('db')
    assert.deepStrictEqual(child.category, ['app', 'db'])
  })

  it('child of child has correct category', () => {
    const log = createLogger('app')
    const child = log.child('db').child('queries')
    assert.deepStrictEqual(child.category, ['app', 'db', 'queries'])
  })

  it('records bubble up to parent sinks (hierarchical dispatch)', () => {
    const parentImpl = LoggerImpl.getLogger(['app'])
    const { sink, records } = captureSink()
    parentImpl.sinks.push(sink)

    const log = createLogger('app')
    const child = log.child('db')
    child.info('query executed', { table: 'users', ms: 42 })

    assert.strictEqual(records.length, 1)
    assert.deepStrictEqual(records[0].category, ['app', 'db'])
    assert.strictEqual(records[0].rawMessage, 'query executed')
  })

  it('child sinks run after parent sinks', () => {
    const order: string[] = []

    const parentImpl = LoggerImpl.getLogger(['app'])
    parentImpl.sinks.push(() => order.push('parent'))

    const childImpl = LoggerImpl.getLogger(['app', 'db'])
    childImpl.sinks.push(() => order.push('child'))

    const log = createLogger(['app', 'db'])
    log.info('test')

    assert.deepStrictEqual(order, ['parent', 'child'])
  })

  it('parentSinks: "override" stops upward sink inheritance', () => {
    const parentImpl = LoggerImpl.getLogger(['app'])
    const { sink: parentSink, records: parentRecords } = captureSink()
    parentImpl.sinks.push(parentSink)

    const childImpl = LoggerImpl.getLogger(['app', 'db'])
    const { sink: childSink, records: childRecords } = captureSink()
    childImpl.sinks.push(childSink)
    childImpl.parentSinks = 'override'

    const log = createLogger(['app', 'db'])
    log.info('test')

    assert.strictEqual(parentRecords.length, 0)
    assert.strictEqual(childRecords.length, 1)
  })
})

describe('Logger.with (LoggerCtx)', () => {
  beforeEach(() => resetTree())

  it('.with() attaches properties to all subsequent logs', () => {
    const impl = LoggerImpl.getLogger(['app'])
    const { sink, records } = captureSink()
    impl.sinks.push(sink)

    const log = createLogger('app')
    const reqLog = log.with({ requestId: 'req_abc' })
    reqLog.info('processing started')

    assert.strictEqual(records.length, 1)
    assert.strictEqual(records[0].properties.requestId, 'req_abc')
  })

  it('.with() does not modify the original logger', () => {
    const impl = LoggerImpl.getLogger(['app'])
    const { sink, records } = captureSink()
    impl.sinks.push(sink)

    const log = createLogger('app')
    log.with({ requestId: 'req_abc' })
    log.info('no context')

    assert.strictEqual(records.length, 1)
    assert.strictEqual(records[0].properties.requestId, undefined)
  })

  it('.with() on child preserves parent context', () => {
    const impl = LoggerImpl.getLogger(['app'])
    const { sink, records } = captureSink()
    impl.sinks.push(sink)

    const log = createLogger('app')
    const ctxLog = log.with({ a: 1 })
    const childLog = ctxLog.child('db')
    childLog.info('query')

    assert.strictEqual(records.length, 1)
    assert.strictEqual(records[0].properties.a, 1)
    assert.deepStrictEqual(records[0].category, ['app', 'db'])
  })

  it('chained .with() merges properties', () => {
    const impl = LoggerImpl.getLogger(['app'])
    const { sink, records } = captureSink()
    impl.sinks.push(sink)

    const log = createLogger('app')
    const ctxLog = log.with({ a: 1 }).with({ b: 2 })
    ctxLog.info('test')

    assert.strictEqual(records[0].properties.a, 1)
    assert.strictEqual(records[0].properties.b, 2)
  })

  it('message properties override context properties', () => {
    const impl = LoggerImpl.getLogger(['app'])
    const { sink, records } = captureSink()
    impl.sinks.push(sink)

    const log = createLogger('app')
    const ctxLog = log.with({ key: 'from-context' })
    ctxLog.info('test', { key: 'from-message' })

    assert.strictEqual(records[0].properties.key, 'from-message')
  })

  it('.with() properties-only log merges context', () => {
    const impl = LoggerImpl.getLogger(['app'])
    const { sink, records } = captureSink()
    impl.sinks.push(sink)

    const log = createLogger('app')
    const ctxLog = log.with({ requestId: 'req_1' })
    ctxLog.info({ action: 'click' })

    assert.strictEqual(records[0].properties.requestId, 'req_1')
    assert.strictEqual(records[0].properties.action, 'click')
  })
})

describe('isEnabledFor', () => {
  beforeEach(() => resetTree())

  it('returns false when no sinks exist', () => {
    const log = createLogger('test')
    assert.strictEqual(log.isEnabledFor('info'), false)
    assert.strictEqual(log.isEnabledFor('error'), false)
  })

  it('returns true when sinks exist', () => {
    const impl = LoggerImpl.getLogger(['test'])
    impl.sinks.push(() => {})

    const log = createLogger('test')
    assert.strictEqual(log.isEnabledFor('info'), true)
  })

  it('returns true when parent sinks exist', () => {
    const parentImpl = LoggerImpl.getLogger(['app'])
    parentImpl.sinks.push(() => {})

    const log = createLogger(['app', 'db'])
    assert.strictEqual(log.isEnabledFor('info'), true)
  })

  it('respects lowestLevel', () => {
    const impl = LoggerImpl.getLogger(['test'])
    impl.sinks.push(() => {})
    impl.lowestLevel = 'warning'

    const log = createLogger('test')
    assert.strictEqual(log.isEnabledFor('info'), false)
    assert.strictEqual(log.isEnabledFor('warning'), true)
    assert.strictEqual(log.isEnabledFor('error'), true)
  })
})

describe('filters', () => {
  beforeEach(() => resetTree())

  it('filters block records from reaching sinks', () => {
    const impl = LoggerImpl.getLogger(['app'])
    const { sink, records } = captureSink()
    impl.sinks.push(sink)
    impl.filters.push((record) => record.level !== 'debug')

    const log = createLogger('app')
    log.debug('should be blocked')
    log.info('should pass')

    assert.strictEqual(records.length, 1)
    assert.strictEqual(records[0].rawMessage, 'should pass')
  })

  it('child inherits parent filters when it has none', () => {
    const parentImpl = LoggerImpl.getLogger(['app'])
    const { sink, records } = captureSink()
    parentImpl.sinks.push(sink)
    parentImpl.filters.push((record) => record.level !== 'debug')

    const log = createLogger(['app', 'db'])
    log.debug('should be blocked')
    log.info('should pass')

    assert.strictEqual(records.length, 1)
    assert.strictEqual(records[0].rawMessage, 'should pass')
  })

  it('child filters replace parent filters (AD-7)', () => {
    const parentImpl = LoggerImpl.getLogger(['app'])
    const { sink, records } = captureSink()
    parentImpl.sinks.push(sink)
    // Parent blocks debug
    parentImpl.filters.push((record) => record.level !== 'debug')

    const childImpl = LoggerImpl.getLogger(['app', 'db'])
    // Child allows everything
    childImpl.filters.push(() => true)

    const log = createLogger(['app', 'db'])
    log.debug('should pass because child allows it')

    assert.strictEqual(records.length, 1)
    assert.strictEqual(records[0].rawMessage, 'should pass because child allows it')
  })
})

describe('singleton root', () => {
  beforeEach(() => resetTree())

  it('Symbol.for("logscope.rootLogger") on globalThis is reused', () => {
    const root1 = LoggerImpl.getRoot()
    const root2 = LoggerImpl.getRoot()
    assert.strictEqual(root1, root2)
  })

  it('root has empty category', () => {
    const root = LoggerImpl.getRoot()
    assert.deepStrictEqual(root.category, [])
  })

  it('root has no parent', () => {
    const root = LoggerImpl.getRoot()
    assert.strictEqual(root.parent, null)
  })
})

describe('LoggerImpl.resetDescendants', () => {
  beforeEach(() => resetTree())

  it('clears sinks and filters from the tree', () => {
    const impl = LoggerImpl.getLogger(['app'])
    const { sink, records } = captureSink()
    impl.sinks.push(sink)
    impl.filters.push(() => true)

    const log = createLogger('app')
    log.info('before reset')
    assert.strictEqual(records.length, 1)

    // Reset
    LoggerImpl.getRoot().resetDescendants()

    log.info('after reset')
    // No new records because sinks were cleared
    assert.strictEqual(records.length, 1)
  })
})

describe('sink error handling (AD-6)', () => {
  beforeEach(() => resetTree())

  it('sink errors do not propagate to the caller', () => {
    const impl = LoggerImpl.getLogger(['app'])
    impl.sinks.push(() => {
      throw new Error('sink exploded')
    })

    const log = createLogger('app')
    assert.doesNotThrow(() => {
      log.info('this should not throw')
    })
  })

  it('sink errors are logged to meta logger', () => {
    const metaImpl = LoggerImpl.getLogger(['logscope', 'meta'])
    const { sink: metaSink, records: metaRecords } = captureSink()
    metaImpl.sinks.push(metaSink)

    const impl = LoggerImpl.getLogger(['app'])
    impl.sinks.push(() => {
      throw new Error('sink exploded')
    })

    const log = createLogger('app')
    log.info('trigger error')

    assert.strictEqual(metaRecords.length, 1)
    assert.strictEqual(metaRecords[0].level, 'error')
    assert.deepStrictEqual(metaRecords[0].category, ['logscope', 'meta'])
    assert.ok(
      metaRecords[0].message.some(
        (part) => typeof part === 'string' && part.includes('sink exploded'),
      ),
    )
  })

  it('failing sink is bypassed when logging to meta logger', () => {
    // This tests that we don't get infinite recursion if the meta logger
    // has the same failing sink
    const callCount = { value: 0 }
    const failingSink: Sink = () => {
      callCount.value++
      throw new Error('always fails')
    }

    const impl = LoggerImpl.getLogger(['app'])
    impl.sinks.push(failingSink)

    // Also attach the failing sink to meta logger
    const metaImpl = LoggerImpl.getLogger(['logscope', 'meta'])
    metaImpl.sinks.push(failingSink)

    const log = createLogger('app')
    assert.doesNotThrow(() => {
      log.info('trigger')
    })

    // failingSink should have been called once for original, then bypassed for meta
    assert.strictEqual(callCount.value, 1)
  })
})
