import {
  configure,
  createLogger,
  dispose,
  getAnsiColorFormatter,
  getConsoleSink,
  getJsonFormatter,
  withFilter,
  getLevelFilter,
} from 'logscope'

// ============================================================================
// 1. Configure logscope
// ============================================================================
// configure() wires the logger tree to sinks. Only called once at app startup.
// Library authors never call this — their logs are silent until the app configures.

await configure({
  sinks: {
    // Pretty colored output for the terminal
    console: getConsoleSink({ formatter: getAnsiColorFormatter() }),
    // JSON sink filtered to warning+ (simulates a structured log destination)
    json: withFilter(
      getConsoleSink({ formatter: getJsonFormatter() }),
      getLevelFilter('warning'),
    ),
  },
  loggers: [
    // Root app logger — all levels go to console
    { category: 'my-app', level: 'debug', sinks: ['console', 'json'] },
    // The "audit" branch overrides parent sinks — only gets JSON output
    { category: ['my-app', 'audit'], sinks: ['json'], parentSinks: 'override' },
  ],
})

// ============================================================================
// 2. Basic logging — string messages and properties
// ============================================================================

const log = createLogger('my-app')

console.log('\n--- Basic Logging ---\n')

log.info('application started', { version: '1.0.0', env: 'development' })
log.debug('loading configuration', { configPath: './config.json' })
log.warn('deprecated API used', { endpoint: '/v1/users', replacement: '/v2/users' })
log.error('failed to connect to cache', { host: 'redis://localhost:6379', retries: 3 })

// Properties-only log (no message string)
log.info({ action: 'page_view', path: '/home', referrer: 'https://example.com' })

// ============================================================================
// 3. Child loggers — hierarchical categories
// ============================================================================
// Child loggers inherit parent sinks. category: ['my-app', 'db']

console.log('\n--- Child Loggers ---\n')

const dbLog = log.child('db')
dbLog.info('connection pool created', { pool: 'primary', size: 10 })
dbLog.debug('query executed', { sql: 'SELECT * FROM users', ms: 42 })
dbLog.warn('slow query detected', { sql: 'SELECT * FROM orders JOIN ...', ms: 1200 })

const httpLog = log.child('http')
httpLog.info('server listening', { port: 3000, host: '0.0.0.0' })

// ============================================================================
// 4. .with() context — reusable properties
// ============================================================================
// .with() creates a contextual wrapper. Every log from it carries extra properties.

console.log('\n--- .with() Context ---\n')

const reqLog = log.with({ requestId: 'req_abc123', userId: 'user_42' })
reqLog.info('processing request', { method: 'POST', path: '/checkout' })
reqLog.debug('validating cart items', { itemCount: 3 })
reqLog.info('request completed', { status: 200, duration: 150 })

// .with() on a child — context flows down
const reqDbLog = reqLog.child('db')
reqDbLog.info('query for request', { table: 'orders' })

// ============================================================================
// 5. Scoped wide events — accumulate context, emit once
// ============================================================================
// A scope collects structured data over a unit of work and emits a single
// rich event at the end. Duration is automatically tracked.

console.log('\n--- Scoped Wide Events ---\n')

// 5a. Normal scope (emits at info level)
const scope = log.scope({ method: 'POST', path: '/checkout' })
scope.set({ user: { id: 'user_42', plan: 'premium' } })
scope.set({ cart: { items: 3, total: 99.99 } })
scope.set({ payment: { method: 'card', last4: '4242' } })
scope.info('cart validated')
scope.info('payment processed')
scope.emit()

// 5b. Scope with error — level escalates to error
console.log('')
const errorScope = log.scope({ method: 'POST', path: '/transfer' })
errorScope.set({ from: 'account_a', to: 'account_b', amount: 500 })
errorScope.error(new Error('Insufficient funds'), { balance: 200 })
errorScope.emit()

// 5c. Scope with warning — level escalates to warning
console.log('')
const warnScope = log.scope({ method: 'GET', path: '/users' })
warnScope.set({ query: { limit: 1000, offset: 0 } })
warnScope.warn('large result set requested', { threshold: 100 })
warnScope.emit()

// ============================================================================
// 6. Hierarchical dispatch — parent receives child logs
// ============================================================================
// By default, sinks "bubble up" — a child's logs reach the parent's sinks.
// This was already demonstrated above: dbLog and httpLog logs appear in the
// console sink configured on 'my-app'.

console.log('\n--- parentSinks: override ---\n')

// The "audit" logger was configured with parentSinks: 'override', so it
// only uses the JSON sink — no ANSI colored output.
const auditLog = log.child('audit')
auditLog.warn('permission changed', {
  targetUser: 'user_99',
  oldRole: 'viewer',
  newRole: 'admin',
  changedBy: 'user_1',
})

// ============================================================================
// 7. Cleanup
// ============================================================================

console.log('\n--- Done ---\n')

await dispose()
