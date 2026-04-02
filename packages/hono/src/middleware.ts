import type { Context, MiddlewareHandler } from 'hono'
import type { Logger, Scope } from 'logscope'
import { withContext } from 'logscope'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LogscopeOptions {
  /**
   * The logger instance to use for request logging.
   * Typically created via `createLogger('my-app')` or a child logger.
   */
  logger: Logger

  /**
   * Generate a unique request ID. Defaults to `crypto.randomUUID()`.
   * Return `undefined` to skip adding a requestId.
   */
  generateRequestId?: () => string | undefined

  /**
   * Extract initial scope context from the request.
   * Called at the start of each request to seed the scope.
   *
   * Defaults to `{ method, path }`.
   */
  getRequestContext?: (c: Context) => Record<string, unknown>

  /**
   * Extract response context to merge before emitting.
   * Called after the handler completes.
   *
   * Defaults to `{ response: { status } }`.
   */
  getResponseContext?: (c: Context) => Record<string, unknown>

  /**
   * Use `withContext()` to propagate requestId (and any initial context)
   * as implicit context via AsyncLocalStorage.
   *
   * Requires `contextLocalStorage` to be set in `configure()`.
   * Defaults to `true`.
   */
  implicitContext?: boolean
}

// ---------------------------------------------------------------------------
// Hono variable type augmentation
// ---------------------------------------------------------------------------

/**
 * Type-safe variables set on the Hono context by the middleware.
 * Users can access `c.get('scope')` and `c.get('requestLogger')` in handlers.
 */
export interface LogscopeVariables {
  scope: Scope
  requestLogger: Logger
  requestId: string | undefined
}

// ---------------------------------------------------------------------------
// Default helpers
// ---------------------------------------------------------------------------

function defaultGenerateRequestId(): string | undefined {
  // crypto.randomUUID is available in Node 19+, Deno, Bun, and modern browsers
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return undefined
}

function defaultGetRequestContext(c: Context): Record<string, unknown> {
  const url = new URL(c.req.url)
  return {
    method: c.req.method,
    path: url.pathname,
  }
}

function defaultGetResponseContext(c: Context): Record<string, unknown> {
  return {
    response: {
      status: c.res.status,
    },
  }
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Creates a Hono middleware that automatically creates a scoped wide event
 * for each HTTP request. The scope accumulates context throughout the request
 * lifecycle and emits a single structured log event when the response completes.
 *
 * Sets three variables on the Hono context:
 * - `c.get('scope')` — the request Scope (call `.set()` to add context)
 * - `c.get('requestLogger')` — a Logger with requestId attached via `.with()`
 * - `c.get('requestId')` — the generated request ID (or undefined)
 *
 * @example
 * ```typescript
 * import { Hono } from 'hono'
 * import { createLogger, configure, getConsoleSink } from 'logscope'
 * import { logscope } from '@logscope/hono'
 *
 * const log = createLogger('my-app')
 *
 * await configure({
 *   sinks: { console: getConsoleSink() },
 *   loggers: [{ category: 'my-app', sinks: ['console'], level: 'info' }],
 * })
 *
 * const app = new Hono()
 * app.use(logscope({ logger: log }))
 *
 * app.get('/users/:id', (c) => {
 *   const scope = c.get('scope')
 *   scope.set({ user: { id: c.req.param('id') } })
 *   return c.json({ name: 'Alice' })
 * })
 * ```
 */
export function logscope(options: LogscopeOptions): MiddlewareHandler {
  const {
    logger,
    generateRequestId = defaultGenerateRequestId,
    getRequestContext = defaultGetRequestContext,
    getResponseContext = defaultGetResponseContext,
    implicitContext = true,
  } = options

  return async (c, next) => {
    const requestId = generateRequestId()
    const requestContext = getRequestContext(c)

    // Seed the scope with request context + requestId
    const initialContext: Record<string, unknown> = { ...requestContext }
    if (requestId !== undefined) {
      initialContext.requestId = requestId
    }

    const scope = logger.scope(initialContext)

    // Create a request-scoped logger with requestId attached
    const requestLogger =
      requestId !== undefined ? logger.with({ requestId }) : logger

    // Set variables on Hono context for handlers to use
    c.set('scope', scope)
    c.set('requestLogger', requestLogger)
    c.set('requestId', requestId)

    const run = async () => {
      try {
        await next()
      } catch (err) {
        // Record the error on the scope so it emits at error level
        scope.error(
          err instanceof Error ? err : new Error(String(err)),
        )
        throw err
      } finally {
        // Hono's compose catches handler errors internally and sets c.error
        // before they propagate back to middleware, so check c.error as well.
        if (c.error) {
          scope.error(c.error)
        }

        // Merge response context and emit the wide event
        const responseContext = getResponseContext(c)
        scope.emit(responseContext)
      }
    }

    // Optionally wrap in withContext for implicit context propagation
    if (implicitContext && requestId !== undefined) {
      return withContext({ requestId, ...requestContext }, run)
    }

    return run()
  }
}
