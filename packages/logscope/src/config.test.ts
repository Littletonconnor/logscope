import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import { configure, reset, dispose, isConfigured, ConfigError } from './config.ts'
import { createLogger, LoggerImpl, strongRefs } from './logger.ts'
import type { LogRecord } from './record.ts'
import type { Sink } from './sink.ts'

/**
 * Helper: resets the entire logger tree so tests don't interfere.
 */
function resetAll(): void {
  reset()
  // Also clean up root in case reset didn't catch everything
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

describe('configure', () => {
  beforeEach(() => resetAll())

  it('wires sinks to the correct logger tree nodes', async () => {
    const { sink, records } = captureSink()

    await configure({
      sinks: { test: sink },
      loggers: [{ category: 'app', sinks: ['test'] }],
    })

    const log = createLogger('app')
    log.info('hello')

    assert.strictEqual(records.length, 1)
    assert.strictEqual(records[0].rawMessage, 'hello')
    assert.deepStrictEqual(records[0].category, ['app'])
  })

  it('supports array categories', async () => {
    const { sink, records } = captureSink()

    await configure({
      sinks: { test: sink },
      loggers: [{ category: ['app', 'db'], sinks: ['test'] }],
    })

    const log = createLogger(['app', 'db'])
    log.info('query')

    assert.strictEqual(records.length, 1)
    assert.deepStrictEqual(records[0].category, ['app', 'db'])
  })

  it('wires multiple sinks to a single logger', async () => {
    const { sink: sink1, records: records1 } = captureSink()
    const { sink: sink2, records: records2 } = captureSink()

    await configure({
      sinks: { a: sink1, b: sink2 },
      loggers: [{ category: 'app', sinks: ['a', 'b'] }],
    })

    const log = createLogger('app')
    log.info('test')

    assert.strictEqual(records1.length, 1)
    assert.strictEqual(records2.length, 1)
  })

  it('wires filters to loggers', async () => {
    const { sink, records } = captureSink()

    await configure({
      sinks: { test: sink },
      filters: { noDebug: 'info' },
      loggers: [{ category: 'app', sinks: ['test'], filters: ['noDebug'] }],
    })

    const log = createLogger('app')
    log.debug('should be blocked')
    log.info('should pass')

    assert.strictEqual(records.length, 1)
    assert.strictEqual(records[0].rawMessage, 'should pass')
  })

  it('wires custom filter functions', async () => {
    const { sink, records } = captureSink()

    await configure({
      sinks: { test: sink },
      filters: {
        noSecrets: (record: LogRecord) => !record.properties['secret'],
      },
      loggers: [{ category: 'app', sinks: ['test'], filters: ['noSecrets'] }],
    })

    const log = createLogger('app')
    log.info('with secret', { secret: true })
    log.info('no secret', { public: true })

    assert.strictEqual(records.length, 1)
    assert.strictEqual(records[0].rawMessage, 'no secret')
  })

  it('sets lowestLevel optimization', async () => {
    const { sink, records } = captureSink()

    await configure({
      sinks: { test: sink },
      loggers: [{ category: 'app', sinks: ['test'], level: 'warning' }],
    })

    const log = createLogger('app')
    log.info('should not appear')
    log.warning('should appear')
    log.error('should also appear')

    assert.strictEqual(records.length, 2)
    assert.strictEqual(records[0].rawMessage, 'should appear')
    assert.strictEqual(records[1].rawMessage, 'should also appear')
  })

  it('sets parentSinks override mode', async () => {
    const { sink: parentSink, records: parentRecords } = captureSink()
    const { sink: childSink, records: childRecords } = captureSink()

    await configure({
      sinks: { parent: parentSink, child: childSink },
      loggers: [
        { category: 'app', sinks: ['parent'] },
        { category: ['app', 'db'], sinks: ['child'], parentSinks: 'override' },
      ],
    })

    const log = createLogger(['app', 'db'])
    log.info('test')

    assert.strictEqual(parentRecords.length, 0)
    assert.strictEqual(childRecords.length, 1)
  })
})

describe('hierarchical dispatch after configure', () => {
  beforeEach(() => resetAll())

  it('child logs reach parent-configured sinks', async () => {
    const { sink, records } = captureSink()

    await configure({
      sinks: { test: sink },
      loggers: [{ category: 'app', sinks: ['test'] }],
    })

    const log = createLogger('app')
    const child = log.child('db')
    child.info('query executed')

    assert.strictEqual(records.length, 1)
    assert.deepStrictEqual(records[0].category, ['app', 'db'])
    assert.strictEqual(records[0].rawMessage, 'query executed')
  })

  it('deep child logs bubble up through multiple levels', async () => {
    const { sink, records } = captureSink()

    await configure({
      sinks: { test: sink },
      loggers: [{ category: 'app', sinks: ['test'] }],
    })

    const log = createLogger('app')
    const deep = log.child('http').child('handlers')
    deep.info('deep log')

    assert.strictEqual(records.length, 1)
    assert.deepStrictEqual(records[0].category, ['app', 'http', 'handlers'])
  })
})

describe('reset', () => {
  beforeEach(() => resetAll())

  it('clears all state — loggers become silent again', async () => {
    const { sink, records } = captureSink()

    await configure({
      sinks: { test: sink },
      loggers: [{ category: 'app', sinks: ['test'] }],
    })

    const log = createLogger('app')
    log.info('before reset')
    assert.strictEqual(records.length, 1)

    reset()

    log.info('after reset')
    assert.strictEqual(records.length, 1) // no new records
  })

  it('clears the configured flag', async () => {
    const { sink } = captureSink()

    await configure({
      sinks: { test: sink },
      loggers: [{ category: 'app', sinks: ['test'] }],
    })

    assert.strictEqual(isConfigured(), true)
    reset()
    assert.strictEqual(isConfigured(), false)
  })

  it('calls dispose on disposable sinks', async () => {
    let disposed = false
    const baseSink = (_record: LogRecord) => {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const disposeSymbol = (Symbol as any).dispose as symbol | undefined
    if (disposeSymbol) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(baseSink as any)[disposeSymbol] = () => { disposed = true }
    }

    await configure({
      sinks: { test: baseSink },
      loggers: [{ category: 'app', sinks: ['test'] }],
    })

    reset()
    assert.strictEqual(disposed, true)
  })

  it('calls close() on sinks with a close method', async () => {
    let closed = false
    const sink: Sink & { close: () => void } = Object.assign(
      (_record: LogRecord) => {},
      { close: () => { closed = true } },
    )

    await configure({
      sinks: { test: sink },
      loggers: [{ category: 'app', sinks: ['test'] }],
    })

    reset()
    assert.strictEqual(closed, true)
  })
})

describe('dispose', () => {
  beforeEach(() => resetAll())

  it('is an alias for reset', async () => {
    const { sink, records } = captureSink()

    await configure({
      sinks: { test: sink },
      loggers: [{ category: 'app', sinks: ['test'] }],
    })

    const log = createLogger('app')
    log.info('before dispose')
    assert.strictEqual(records.length, 1)

    dispose()

    assert.strictEqual(isConfigured(), false)
    log.info('after dispose')
    assert.strictEqual(records.length, 1) // still 1
  })
})

describe('ConfigError on double configure', () => {
  beforeEach(() => resetAll())

  it('throws ConfigError on duplicate configure() without reset: true', async () => {
    const { sink } = captureSink()

    await configure({
      sinks: { test: sink },
      loggers: [{ category: 'app', sinks: ['test'] }],
    })

    await assert.rejects(
      () =>
        configure({
          sinks: { test: sink },
          loggers: [{ category: 'app', sinks: ['test'] }],
        }),
      (err: Error) => {
        assert.ok(err instanceof ConfigError)
        assert.ok((err as ConfigError).message.includes('already configured'))
        return true
      },
    )
  })

  it('configure({ reset: true }) reconfigures successfully', async () => {
    const { sink: sink1, records: records1 } = captureSink()
    const { sink: sink2, records: records2 } = captureSink()

    await configure({
      sinks: { test: sink1 },
      loggers: [{ category: 'app', sinks: ['test'] }],
    })

    const log = createLogger('app')
    log.info('with sink1')

    await configure({
      sinks: { test: sink2 },
      loggers: [{ category: 'app', sinks: ['test'] }],
      reset: true,
    })

    log.info('with sink2')

    assert.strictEqual(records1.length, 1)
    assert.strictEqual(records2.length, 1)
    assert.strictEqual(records1[0].rawMessage, 'with sink1')
    assert.strictEqual(records2[0].rawMessage, 'with sink2')
  })
})

describe('ConfigError on invalid config', () => {
  beforeEach(() => resetAll())

  it('throws on duplicate categories', async () => {
    const { sink } = captureSink()

    await assert.rejects(
      () =>
        configure({
          sinks: { test: sink },
          loggers: [
            { category: 'app', sinks: ['test'] },
            { category: 'app', sinks: ['test'] },
          ],
        }),
      (err: Error) => {
        assert.ok(err instanceof ConfigError)
        assert.ok((err as ConfigError).message.includes('Duplicate'))
        return true
      },
    )
  })

  it('throws on unknown sink reference', async () => {
    const { sink } = captureSink()

    await assert.rejects(
      () =>
        configure({
          sinks: { test: sink },
          loggers: [
            { category: 'app', sinks: ['test', 'nonexistent' as 'test'] },
          ],
        }),
      (err: Error) => {
        assert.ok(err instanceof ConfigError)
        assert.ok((err as ConfigError).message.includes('unknown sink'))
        return true
      },
    )
  })

  it('throws on unknown filter reference', async () => {
    const { sink } = captureSink()

    await assert.rejects(
      () =>
        configure({
          sinks: { test: sink },
          filters: { myFilter: 'info' },
          loggers: [
            {
              category: 'app',
              sinks: ['test'],
              filters: ['nonexistent' as 'myFilter'],
            },
          ],
        }),
      (err: Error) => {
        assert.ok(err instanceof ConfigError)
        assert.ok((err as ConfigError).message.includes('unknown filter'))
        return true
      },
    )
  })
})

describe('meta logger auto-configuration', () => {
  beforeEach(() => resetAll())

  it('meta logger gets default console sink when not explicitly configured', async () => {
    const { sink } = captureSink()

    await configure({
      sinks: { test: sink },
      loggers: [{ category: 'app', sinks: ['test'] }],
    })

    // Meta logger should have been auto-configured
    const metaImpl = LoggerImpl.getLogger(['logscope', 'meta'])
    assert.ok(metaImpl.sinks.length > 0, 'meta logger should have a sink')
  })

  it('meta logger is NOT auto-configured when explicitly provided', async () => {
    const { sink: appSink } = captureSink()
    const { sink: metaSink } = captureSink()

    await configure({
      sinks: { app: appSink, meta: metaSink },
      loggers: [
        { category: 'app', sinks: ['app'] },
        { category: ['logscope', 'meta'], sinks: ['meta'] },
      ],
    })

    const metaImpl = LoggerImpl.getLogger(['logscope', 'meta'])
    // Should only have the explicitly configured sink, not the auto one
    assert.strictEqual(metaImpl.sinks.length, 1)
    assert.strictEqual(metaImpl.sinks[0], metaSink)
  })

  it('sink errors are caught and logged to meta logger', async () => {
    const { sink: metaSink, records: metaRecords } = captureSink()
    const failingSink: Sink = () => {
      throw new Error('boom')
    }

    await configure({
      sinks: { bad: failingSink, meta: metaSink },
      loggers: [
        { category: 'app', sinks: ['bad'] },
        { category: ['logscope', 'meta'], sinks: ['meta'] },
      ],
    })

    const log = createLogger('app')
    assert.doesNotThrow(() => {
      log.info('trigger error')
    })

    assert.strictEqual(metaRecords.length, 1)
    assert.strictEqual(metaRecords[0].level, 'error')
    assert.ok(
      metaRecords[0].message.some(
        (part) => typeof part === 'string' && part.includes('boom'),
      ),
    )
  })
})

describe('strongRefs', () => {
  beforeEach(() => resetAll())

  it('configured loggers are added to strongRefs', async () => {
    const { sink } = captureSink()

    assert.strictEqual(strongRefs.size, 0)

    await configure({
      sinks: { test: sink },
      loggers: [{ category: 'app', sinks: ['test'] }],
    })

    // app + meta logger
    assert.ok(strongRefs.size >= 1)
  })

  it('reset clears strongRefs', async () => {
    const { sink } = captureSink()

    await configure({
      sinks: { test: sink },
      loggers: [{ category: 'app', sinks: ['test'] }],
    })

    assert.ok(strongRefs.size > 0)
    reset()
    assert.strictEqual(strongRefs.size, 0)
  })
})

describe('isConfigured', () => {
  beforeEach(() => resetAll())

  it('returns false initially', () => {
    assert.strictEqual(isConfigured(), false)
  })

  it('returns true after configure', async () => {
    const { sink } = captureSink()

    await configure({
      sinks: { test: sink },
      loggers: [{ category: 'app', sinks: ['test'] }],
    })

    assert.strictEqual(isConfigured(), true)
  })

  it('returns false after reset', async () => {
    const { sink } = captureSink()

    await configure({
      sinks: { test: sink },
      loggers: [{ category: 'app', sinks: ['test'] }],
    })

    reset()
    assert.strictEqual(isConfigured(), false)
  })
})

describe('end-to-end integration', () => {
  beforeEach(() => resetAll())

  it('full flow: configure → createLogger → log → sink receives record', async () => {
    const { sink, records } = captureSink()

    await configure({
      sinks: { console: sink },
      loggers: [
        { category: 'my-app', level: 'debug', sinks: ['console'] },
      ],
    })

    const log = createLogger('my-app')
    log.info('user logged in', { userId: '123' })

    assert.strictEqual(records.length, 1)
    assert.deepStrictEqual(records[0].category, ['my-app'])
    assert.strictEqual(records[0].level, 'info')
    assert.strictEqual(records[0].rawMessage, 'user logged in')
    assert.strictEqual(records[0].properties.userId, '123')
  })

  it('library consumer simulation: import and use without configuring', () => {
    const log = createLogger('my-library')
    assert.doesNotThrow(() => {
      log.info('library initialized')
      log.child('module').debug('loaded')
      log.with({ version: '1.0' }).info('ready')
    })
  })

  it('multiple loggers with different levels', async () => {
    const { sink, records } = captureSink()

    await configure({
      sinks: { console: sink },
      loggers: [
        { category: 'app', level: 'debug', sinks: ['console'] },
        { category: ['app', 'db'], level: 'warning', sinks: ['console'] },
      ],
    })

    const appLog = createLogger('app')
    const dbLog = createLogger(['app', 'db'])

    appLog.debug('app debug') // passes (app level=debug)
    dbLog.debug('db debug') // blocked (db level=warning)
    dbLog.warning('db warning') // passes

    // db debug is blocked by lowestLevel, but db warning reaches both db and app sinks
    assert.strictEqual(records.length, 3) // app debug + db warning (via app sink) + db warning (via db sink)
    assert.strictEqual(records[0].rawMessage, 'app debug')
    assert.strictEqual(records[1].rawMessage, 'db warning')
    assert.strictEqual(records[2].rawMessage, 'db warning')
  })
})
