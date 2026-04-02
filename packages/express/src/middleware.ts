import type { Request, Response, NextFunction } from 'express'
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
  generateRequestId?: (req: Request) => string | undefined

  /**
   * Extract initial scope context from the request.
   * Called at the start of each request to seed the scope.
   *
   * Defaults to `{ method, path }`.
   */
  getRequestContext?: (req: Request) => Record<string, unknown>

  /**
   * Extract response context to merge before emitting.
   * Called after the handler completes.
   *
   * Defaults to `{ response: { status } }`.
   */
  getResponseContext?: (
    req: Request,
    res: Response,
  ) => Record<string, unknown>

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
// Augment Express Request with logscope properties
// ---------------------------------------------------------------------------

declare global {
  namespace Express {
    interface Request {
      scope?: Scope
      requestLogger?: Logger
      requestId?: string
    }
  }
}

// ---------------------------------------------------------------------------
// Default helpers
// ---------------------------------------------------------------------------

function defaultGenerateRequestId(_req: Request): string | undefined {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return undefined
}

function defaultGetRequestContext(req: Request): Record<string, unknown> {
  return {
    method: req.method,
    path: req.path,
  }
}

function defaultGetResponseContext(
  _req: Request,
  res: Response,
): Record<string, unknown> {
  return {
    response: {
      status: res.statusCode,
    },
  }
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Creates an Express middleware that automatically creates a scoped wide event
 * for each HTTP request. The scope accumulates context throughout the request
 * lifecycle and emits a single structured log event when the response finishes.
 *
 * Sets three properties on the Express request object:
 * - `req.scope` — the request Scope (call `.set()` to add context)
 * - `req.requestLogger` — a Logger with requestId attached via `.with()`
 * - `req.requestId` — the generated request ID (or undefined)
 *
 * @example
 * ```typescript
 * import express from 'express'
 * import { createLogger, configure, getConsoleSink } from 'logscope'
 * import { logscope } from '@logscope/express'
 *
 * const log = createLogger('my-app')
 *
 * await configure({
 *   sinks: { console: getConsoleSink() },
 *   loggers: [{ category: 'my-app', sinks: ['console'], level: 'info' }],
 * })
 *
 * const app = express()
 * app.use(logscope({ logger: log }))
 *
 * app.get('/users/:id', (req, res) => {
 *   req.scope!.set({ user: { id: req.params.id } })
 *   res.json({ name: 'Alice' })
 * })
 * ```
 */
export function logscope(options: LogscopeOptions) {
  const {
    logger,
    generateRequestId = defaultGenerateRequestId,
    getRequestContext = defaultGetRequestContext,
    getResponseContext = defaultGetResponseContext,
    implicitContext = true,
  } = options

  return (req: Request, res: Response, next: NextFunction): void => {
    const requestId = generateRequestId(req)
    const requestContext = getRequestContext(req)

    // Seed the scope with request context + requestId
    const initialContext: Record<string, unknown> = { ...requestContext }
    if (requestId !== undefined) {
      initialContext.requestId = requestId
    }

    const scope = logger.scope(initialContext)

    // Create a request-scoped logger with requestId attached
    const requestLogger =
      requestId !== undefined ? logger.with({ requestId }) : logger

    // Attach to the Express request object for handlers to use
    req.scope = scope
    req.requestLogger = requestLogger
    req.requestId = requestId

    // Emit the wide event when the response finishes
    res.on('finish', () => {
      const responseContext = getResponseContext(req, res)
      scope.emit(responseContext)
    })

    // Optionally wrap in withContext for implicit context propagation
    if (implicitContext && requestId !== undefined) {
      withContext({ requestId, ...requestContext }, () => {
        next()
      })
    } else {
      next()
    }
  }
}
