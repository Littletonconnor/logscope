import { AsyncLocalStorage } from 'node:async_hooks'

import {
  configure,
  createLogger,
  dispose,
  getConsoleSink,
  getAnsiColorFormatter,
  getPrettyFormatter,
  getAutoFormatter,
  createSamplingFilter,
  createPipeline,
  fingersCrossed,
  categoryIsolation,
  propertyIsolation,
  withFilter,
  withContext,
  withCategoryPrefix,
  type LogRecord,
} from 'logscope'

// ============================================================================
// 1. Configure logscope with advanced sinks and filters
// ============================================================================
// This example uses AsyncLocalStorage to enable implicit context and
// category prefix features.

// A simple collector sink to show pipeline batch output
const batches: LogRecord[][] = []
const pipeline = createPipeline({
  sink: async (batch) => {
    batches.push([...batch])
    console.log(`    [pipeline] flushed batch of ${batch.length} record(s)`)
  },
  batch: { size: 5, intervalMs: 500 },
  maxBufferSize: 100,
  maxAttempts: 2,
  backoff: 'exponential',
  onDropped: (batch, error) => {
    console.log(`    [pipeline] dropped ${batch.length} records: ${error}`)
  },
})

// A collector for fingersCrossed demo
const fcRecords: string[] = []
const fcSink = fingersCrossed(
  (record: LogRecord) => {
    fcRecords.push(
      `[${record.level.toUpperCase()}] ${record.category.join('.')}:` +
        ` ${record.message.filter((p) => typeof p === 'string').join('')}`,
    )
  },
  {
    triggerLevel: 'error',
    bufferSize: 100,
    afterTrigger: 'reset',
  },
)

// Category-isolated fingersCrossed sink
const catFcRecords: string[] = []
const catFcSink = fingersCrossed(
  (record: LogRecord) => {
    catFcRecords.push(
      `[${record.level.toUpperCase()}] ${record.category.join('.')}:` +
        ` ${record.message.filter((p) => typeof p === 'string').join('')}`,
    )
  },
  {
    triggerLevel: 'error',
    isolation: categoryIsolation({ flush: 'descendants' }),
    afterTrigger: 'reset',
  },
)

// Property-isolated fingersCrossed sink (per requestId)
const propFcRecords: string[] = []
const propFcSink = fingersCrossed(
  (record: LogRecord) => {
    propFcRecords.push(
      `[${record.level.toUpperCase()}] reqId=${record.properties.requestId ?? '?'}:` +
        ` ${record.message.filter((p) => typeof p === 'string').join('')}`,
    )
  },
  {
    triggerLevel: 'error',
    isolation: propertyIsolation('requestId', { maxContexts: 100 }),
    afterTrigger: 'reset',
  },
)

// Sampling filter: keep 50% of debug, 100% of info+, force-keep errors
let sampleCallCount = 0
const samplingFilter = createSamplingFilter({
  rates: { trace: 0, debug: 0.5 },
  keepWhen: [
    (r) => r.level === 'error' || r.level === 'fatal',
    (r) => (r.properties.duration as number) >= 1000,
  ],
  // Deterministic "random" for demo — alternates keep/drop
  random: () => (sampleCallCount++ % 2 === 0 ? 0.3 : 0.7),
})

await configure({
  sinks: {
    console: getConsoleSink({ formatter: getAnsiColorFormatter() }),
    pretty: getConsoleSink({ formatter: getPrettyFormatter() }),
    auto: getConsoleSink({ formatter: getAutoFormatter({ production: false }) }),
    sampled: withFilter(
      getConsoleSink({ formatter: getAnsiColorFormatter() }),
      samplingFilter,
    ),
    pipeline,
    fc: fcSink,
    catFc: catFcSink,
    propFc: propFcSink,
  },
  loggers: [
    // Default: pretty output for the main demo
    { category: 'demo', level: 'trace', sinks: ['console'] },
    // Sampling demo branch
    { category: ['demo', 'sampled'], sinks: ['sampled'], parentSinks: 'override' },
    // fingersCrossed demo branches
    { category: ['demo', 'fc'], level: 'debug', sinks: ['fc'], parentSinks: 'override' },
    { category: ['demo', 'catfc'], level: 'debug', sinks: ['catFc'], parentSinks: 'override' },
    { category: ['demo', 'propfc'], level: 'debug', sinks: ['propFc'], parentSinks: 'override' },
    // Pipeline demo
    { category: ['demo', 'pipeline'], level: 'debug', sinks: ['pipeline'], parentSinks: 'override' },
    // Pretty formatter demo
    { category: ['demo', 'pretty'], level: 'info', sinks: ['pretty'], parentSinks: 'override' },
    // Auto formatter demo
    { category: ['demo', 'auto'], level: 'info', sinks: ['auto'], parentSinks: 'override' },
    // Context demo — uses main console
    { category: 'ctx', level: 'debug', sinks: ['console'] },
    // withCategoryPrefix demo — catches prefixed loggers
    { category: 'my-sdk', level: 'debug', sinks: ['console'] },
  ],
  contextLocalStorage: new AsyncLocalStorage<Record<string, unknown>>(),
})

const log = createLogger('demo')

// ============================================================================
// 2. Sampling filter
// ============================================================================
// Head sampling drops a percentage of low-severity logs. Tail sampling
// force-keeps records matching specific conditions (e.g., errors, slow requests).

console.log('\n=== Sampling Filter ===\n')

const sampledLog = log.child('sampled')

// trace is configured at 0% — always dropped
sampledLog.trace('this trace will be dropped')

// debug at 50% — our deterministic random alternates keep/drop
sampledLog.debug('debug message 1 (kept — random=0.3)')
sampledLog.debug('debug message 2 (dropped — random=0.7)')
sampledLog.debug('debug message 3 (kept — random=0.3)')

// info at 100% (default) — always kept
sampledLog.info('info always passes')

// Tail sampling: error is force-kept regardless of rate
sampledLog.error('error force-kept via tail condition')

// Tail sampling: slow request force-kept
sampledLog.info('slow request', { duration: 1500 })

// ============================================================================
// 3. fingersCrossed sink — global buffer
// ============================================================================
// Buffers debug/info logs silently. When an error arrives, the entire buffer
// is flushed — giving you full context leading up to the error.

console.log('\n=== fingersCrossed — Global Buffer ===\n')

const fcLog = log.child('fc')

fcRecords.length = 0
fcLog.debug('connecting to database')
fcLog.info('query started', { sql: 'SELECT * FROM users' })
fcLog.debug('parsing response rows')

console.log(`  Before error: ${fcRecords.length} records flushed (should be 0)`)

fcLog.error('connection timeout', { host: 'db.example.com', timeoutMs: 5000 })

console.log(`  After error: ${fcRecords.length} records flushed (should be 4)`)
for (const r of fcRecords) {
  console.log(`    ${r}`)
}

// After 'reset' mode, buffering resumes
fcRecords.length = 0
fcLog.debug('reconnecting...')
fcLog.info('reconnected successfully')
console.log(`  After reset: ${fcRecords.length} records flushed (should be 0, buffering again)`)

// ============================================================================
// 4. fingersCrossed — category isolation
// ============================================================================
// Each category gets its own buffer. An error in one category doesn't flush
// another's buffer. With 'descendants' mode, child categories are also flushed.

console.log('\n=== fingersCrossed — Category Isolation ===\n')

const catFcLog = log.child('catfc')
const dbLog = catFcLog.child('db')
const httpLog = catFcLog.child('http')

catFcRecords.length = 0

// Buffer logs in both categories
dbLog.debug('opening connection pool')
dbLog.info('pool ready', { size: 10 })
httpLog.debug('server starting')
httpLog.info('listening on :3000')

console.log(`  Before error: ${catFcRecords.length} records flushed (should be 0)`)

// Error only in db — only db (and descendants) should flush
dbLog.error('deadlock detected', { table: 'orders' })

console.log(`  After db error: ${catFcRecords.length} records flushed`)
for (const r of catFcRecords) {
  console.log(`    ${r}`)
}
console.log('  (Notice: http logs were NOT flushed — they remain buffered)')

// ============================================================================
// 5. fingersCrossed — property isolation (per-request)
// ============================================================================
// Each requestId gets its own buffer. An error in one request doesn't reveal
// another request's debug logs.

console.log('\n=== fingersCrossed — Property Isolation ===\n')

const propFcLog = log.child('propfc')

propFcRecords.length = 0

// Simulate two concurrent requests
const req1 = propFcLog.with({ requestId: 'req_001' })
const req2 = propFcLog.with({ requestId: 'req_002' })

req1.debug('parsing request body')
req1.info('validated input')
req2.debug('parsing request body')
req2.info('validated input')

console.log(`  Before error: ${propFcRecords.length} flushed (should be 0)`)

// Only req_001 hits an error
req1.error('validation failed', { field: 'email' })

console.log(`  After req_001 error: ${propFcRecords.length} flushed`)
for (const r of propFcRecords) {
  console.log(`    ${r}`)
}
console.log('  (Notice: req_002 logs were NOT flushed)')

// ============================================================================
// 6. createPipeline — batched async processing
// ============================================================================
// Buffers records and flushes in batches. Shows batch size, interval-based
// flushing, and the onDropped callback.

console.log('\n=== createPipeline — Batched Processing ===\n')

const pipeLog = log.child('pipeline')

// Send 7 records — batch size is 5, so first 5 flush immediately
for (let i = 1; i <= 7; i++) {
  pipeLog.info(`event ${i}`, { index: i })
}

// Wait for the interval flush to pick up the remaining 2
console.log('  Sent 7 records (batch size=5). Waiting for flush...')
await new Promise((resolve) => setTimeout(resolve, 700))

console.log(`  Total batches received: ${batches.length}`)
for (let i = 0; i < batches.length; i++) {
  console.log(`    Batch ${i + 1}: ${batches[i].length} records`)
}

// ============================================================================
// 7. Implicit context with withContext + AsyncLocalStorage
// ============================================================================
// Properties set via withContext() are automatically attached to all log
// records within the callback — no need to pass them explicitly.

console.log('\n=== Implicit Context (withContext) ===\n')

const ctxLog = createLogger('ctx')

withContext({ requestId: 'req_abc', traceId: 'trace_xyz' }, () => {
  ctxLog.info('handling request')

  // Nested context — inner overrides outer for same keys
  withContext({ userId: 'user_42', requestId: 'req_abc_inner' }, () => {
    ctxLog.info('user authenticated')
    ctxLog.debug('loading preferences', { theme: 'dark' })
  })

  ctxLog.info('request completed', { status: 200 })
})

// Outside withContext — no implicit context attached
ctxLog.info('no context here')

// ============================================================================
// 8. Context priority: message props > .with() > withContext
// ============================================================================

console.log('\n=== Context Priority ===\n')

withContext({ source: 'implicit', requestId: 'implicit_req' }, () => {
  const withLog = ctxLog.with({ source: 'explicit', userId: 'explicit_user' })

  // 'source' in message props wins over .with() and withContext
  withLog.info('priority demo', { source: 'message', extra: true })
  // Output should show: source=message, userId=explicit_user, requestId=implicit_req
})

// ============================================================================
// 9. withCategoryPrefix — SDK namespacing
// ============================================================================
// Library/SDK authors can use withCategoryPrefix to automatically namespace
// all loggers created within a callback.

console.log('\n=== withCategoryPrefix ===\n')

withCategoryPrefix('my-sdk', () => {
  // This logger's category becomes ['my-sdk', 'http'] instead of just ['http']
  const sdkLog = createLogger('http')
  sdkLog.info('request sent', { url: 'https://api.example.com' })

  // Nested prefix
  withCategoryPrefix('internal', () => {
    const innerLog = createLogger('cache')
    // Category: ['my-sdk', 'internal', 'cache']
    innerLog.info('cache hit', { key: 'user:42' })
  })
})

// ============================================================================
// 10. Pretty formatter — tree-formatted wide events
// ============================================================================
// The pretty formatter renders wide event properties as an indented tree
// with box-drawing characters, making complex structured data readable.

console.log('\n=== Pretty Formatter ===\n')

const prettyLog = log.child('pretty')

// A simple structured log
prettyLog.info('server started', { port: 3000, host: '0.0.0.0', env: 'development' })

// A scoped wide event with nested data — shows the tree rendering
const scope = prettyLog.scope({ method: 'POST', path: '/api/checkout' })
scope.set({
  user: { id: 'user_42', plan: 'premium', email: 'alice@example.com' },
})
scope.set({
  cart: {
    items: [
      { sku: 'WIDGET-1', qty: 2, price: 19.99 },
      { sku: 'GADGET-3', qty: 1, price: 59.99 },
    ],
    total: 99.97,
  },
})
scope.set({ payment: { method: 'card', last4: '4242', approved: true } })
scope.info('cart validated')
scope.info('payment processed')
scope.emit()

// ============================================================================
// 11. Auto formatter — dev/prod detection
// ============================================================================
// getAutoFormatter() automatically selects pretty output in development
// and JSON output in production, based on NODE_ENV.

console.log('\n=== Auto Formatter (dev mode) ===\n')

const autoLog = log.child('auto')

autoLog.info('auto-detected format', {
  mode: 'development',
  reason: 'NODE_ENV !== "production"',
})

console.log('\n  (In production, this would output JSON instead of pretty text)')

// ============================================================================
// 12. Cleanup
// ============================================================================

console.log('\n=== Done ===\n')

await dispose()
