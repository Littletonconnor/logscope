/**
 * Verify that README code examples compile and run correctly.
 * Run with: node --experimental-strip-types scripts/verify-readme.ts
 */
import {
  configure,
  createLogger,
  getConsoleSink,
  getTextFormatter,
  getJsonFormatter,
  getAnsiColorFormatter,
  withContext,
  reset,
} from '../packages/logscope/src/index.ts'
import { AsyncLocalStorage } from 'node:async_hooks'

async function verifyQuickStart() {
  console.log('=== Quick Start ===')
  await configure({
    sinks: {
      console: getConsoleSink(),
    },
    loggers: [{ category: 'my-app', level: 'debug', sinks: ['console'] }],
  })

  const log = createLogger('my-app')

  // Structured logs
  log.info({ action: 'page_view', path: '/home' })
  log.info('user logged in', { userId: '123', method: 'oauth' })
  log.warn('slow query', { duration: 1200, table: 'users' })
  log.error('payment failed', { orderId: 'abc', reason: 'card_declined' })

  reset()
}

async function verifyLibraryFirst() {
  console.log('\n=== Library-First (unconfigured = silent) ===')
  const log = createLogger('my-awesome-lib')

  // Should produce no output
  log.debug('processing started', { step: 'init' })
  log.info('this should be silent')
  console.log('(no output above = correct)')
}

async function verifyScopedEvents() {
  console.log('\n=== Scoped Wide Events ===')
  await configure({
    sinks: { console: getConsoleSink() },
    loggers: [{ category: 'my-app', level: 'debug', sinks: ['console'] }],
    reset: true,
  })

  const log = createLogger('my-app')
  const scope = log.scope({ method: 'POST', path: '/api/checkout' })

  scope.set({ user: { id: '123', plan: 'premium' } })
  scope.set({ cart: { items: 3, total: 99.99 } })

  try {
    // Simulate success
    scope.set({ payment: { id: 'pay_123', method: 'card' } })
  } catch (error) {
    scope.error('payment failed', { reason: (error as Error).message })
  }

  scope.emit()
  reset()
}

async function verifyHierarchicalCategories() {
  console.log('\n=== Hierarchical Categories ===')
  await configure({
    sinks: { console: getConsoleSink() },
    loggers: [
      { category: 'my-app', level: 'info', sinks: ['console'] },
      { category: ['my-app', 'db'], level: 'warning', sinks: ['console'], parentSinks: 'override' },
    ],
    reset: true,
  })

  const appLog = createLogger('my-app')
  const dbLog = appLog.child('db')
  const authLog = appLog.child('auth')

  appLog.info('app started')
  dbLog.info('this should be filtered (below warn)')
  dbLog.warn('slow query', { table: 'users' })
  authLog.info('user logged in')

  reset()
}

async function verifyContext() {
  console.log('\n=== Context (.with) ===')
  await configure({
    sinks: { console: getConsoleSink() },
    loggers: [{ category: 'my-app', level: 'debug', sinks: ['console'] }],
    reset: true,
  })

  const log = createLogger('my-app')
  const reqLog = log.with({ requestId: 'req_abc', userId: '123' })

  reqLog.info('processing started')
  reqLog.info('step completed')

  reset()
}

async function verifyWithContext() {
  console.log('\n=== Implicit Context (withContext) ===')
  await configure({
    sinks: { console: getConsoleSink() },
    loggers: [{ category: 'my-app', level: 'debug', sinks: ['console'] }],
    contextLocalStorage: new AsyncLocalStorage(),
    reset: true,
  })

  const log = createLogger('my-app')

  withContext({ requestId: 'req_abc' }, () => {
    log.info('handling request')
    withContext({ userId: '123' }, () => {
      log.info('processing')
    })
  })

  reset()
}

async function verifyFormatters() {
  console.log('\n=== Formatters ===')

  // Text formatter
  await configure({
    sinks: { console: getConsoleSink({ formatter: getTextFormatter() }) },
    loggers: [{ category: 'my-app', level: 'debug', sinks: ['console'] }],
    reset: true,
  })
  createLogger('my-app').info('text formatter test', { key: 'value' })
  reset()

  // JSON formatter
  await configure({
    sinks: { console: getConsoleSink({ formatter: getJsonFormatter() }) },
    loggers: [{ category: 'my-app', level: 'debug', sinks: ['console'] }],
    reset: true,
  })
  createLogger('my-app').info('json formatter test', { key: 'value' })
  reset()

  // ANSI color formatter
  await configure({
    sinks: { console: getConsoleSink({ formatter: getAnsiColorFormatter() }) },
    loggers: [{ category: 'my-app', level: 'debug', sinks: ['console'] }],
    reset: true,
  })
  createLogger('my-app').info('ansi formatter test', { key: 'value' })
  reset()
}

async function verifyFilters() {
  console.log('\n=== Filters ===')
  await configure({
    sinks: { console: getConsoleSink() },
    filters: {
      slowOnly(record) {
        return (record.properties.duration as number) > 100
      },
    },
    loggers: [{ category: 'my-app', sinks: ['console'], filters: ['slowOnly'] }],
    reset: true,
  })

  const log = createLogger('my-app')
  log.info('fast query', { duration: 10 }) // should be filtered
  log.info('slow query', { duration: 1200 }) // should pass

  reset()
}

async function verifyCustomSink() {
  console.log('\n=== Custom Sink ===')
  const records: unknown[] = []
  await configure({
    sinks: {
      myApi(record) {
        records.push(record)
        console.log('Custom sink received:', record.level, record.rawMessage)
      },
    },
    loggers: [{ category: 'my-app', sinks: ['myApi'] }],
    reset: true,
  })

  createLogger('my-app').info('hello from custom sink')
  console.log(`Custom sink captured ${records.length} record(s)`)

  reset()
}

// Run all verifications
async function main() {
  try {
    await verifyLibraryFirst()
    await verifyQuickStart()
    await verifyScopedEvents()
    await verifyHierarchicalCategories()
    await verifyContext()
    await verifyWithContext()
    await verifyFormatters()
    await verifyFilters()
    await verifyCustomSink()
    console.log('\n✅ All README examples verified successfully!')
  } catch (err) {
    console.error('\n❌ Verification failed:', err)
    process.exit(1)
  }
}

main()
