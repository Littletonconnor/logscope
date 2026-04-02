import type { NextRequest, NextResponse } from 'next/server'
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
  generateRequestId?: (req: NextRequest) => string | undefined

  /**
   * Extract initial scope context from the request.
   * Called at the start of each request to seed the scope.
   *
   * Defaults to `{ method, path }`.
   */
  getRequestContext?: (req: NextRequest) => Record<string, unknown>

  /**
   * Extract response context to merge before emitting.
   * Called after the handler completes.
   *
   * Defaults to `{ response: { status } }`.
   */
  getResponseContext?: (
    req: NextRequest,
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

/**
 * The context object passed to wrapped Route Handlers.
 * Provides access to the request scope and a request-scoped logger.
 */
export interface LogscopeContext {
  /** The request Scope — call `.set()` to accumulate structured context. */
  scope: Scope
  /** A Logger with requestId attached via `.with()`. */
  requestLogger: Logger
  /** The generated request ID, or undefined if generation was skipped. */
  requestId: string | undefined
}

/**
 * A Next.js Route Handler signature extended with logscope context.
 *
 * The second parameter is the standard Next.js route context (with `params`),
 * extended with `logscope` containing the scope, logger, and requestId.
 */
export type LogscopeRouteHandler = (
  req: NextRequest,
  context: { params: Promise<Record<string, string | string[]>>; logscope: LogscopeContext },
) => Response | Promise<Response>

/**
 * Standard Next.js Route Handler type for the outer wrapper return.
 */
type NextRouteHandler = (
  req: NextRequest,
  context: { params: Promise<Record<string, string | string[]>> },
) => Response | Promise<Response>

// ---------------------------------------------------------------------------
// Default helpers
// ---------------------------------------------------------------------------

function defaultGenerateRequestId(_req: NextRequest): string | undefined {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return undefined
}

function defaultGetRequestContext(req: NextRequest): Record<string, unknown> {
  const url = new URL(req.url)
  return {
    method: req.method,
    path: url.pathname,
  }
}

function defaultGetResponseContext(
  _req: NextRequest,
  res: Response,
): Record<string, unknown> {
  return {
    response: {
      status: res.status,
    },
  }
}

// ---------------------------------------------------------------------------
// Route Handler wrapper
// ---------------------------------------------------------------------------

/**
 * Wraps a Next.js Route Handler with automatic request-scoped wide event
 * logging. Creates a scope at the start of the request, provides it to the
 * handler via the `logscope` context property, and emits a single structured
 * log event when the response completes.
 *
 * @example
 * ```typescript
 * // app/api/users/[id]/route.ts
 * import { createLogger } from 'logscope'
 * import { withLogscope } from '@logscope/next'
 *
 * const log = createLogger(['my-app', 'api'])
 *
 * export const GET = withLogscope({ logger: log }, async (req, { params, logscope }) => {
 *   const { id } = await params
 *   logscope.scope.set({ user: { id } })
 *   return Response.json({ name: 'Alice' })
 * })
 * ```
 */
export function withLogscope(
  options: LogscopeOptions,
  handler: LogscopeRouteHandler,
): NextRouteHandler {
  const {
    logger,
    generateRequestId = defaultGenerateRequestId,
    getRequestContext = defaultGetRequestContext,
    getResponseContext = defaultGetResponseContext,
    implicitContext = true,
  } = options

  return async (req: NextRequest, routeContext) => {
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

    const logscopeCtx: LogscopeContext = { scope, requestLogger, requestId }

    const run = async (): Promise<Response> => {
      try {
        const res = await handler(req, { ...routeContext, logscope: logscopeCtx })

        // Merge response context and emit the wide event
        const responseContext = getResponseContext(req, res)
        scope.emit(responseContext)

        return res
      } catch (err) {
        // Record the error on the scope so it emits at error level
        scope.error(err instanceof Error ? err : new Error(String(err)))
        scope.emit()
        throw err
      }
    }

    // Optionally wrap in withContext for implicit context propagation
    if (implicitContext && requestId !== undefined) {
      return withContext({ requestId, ...requestContext }, run)
    }

    return run()
  }
}

// ---------------------------------------------------------------------------
// Server Action wrapper
// ---------------------------------------------------------------------------

/**
 * Options for wrapping a Server Action with logscope.
 */
export interface LogscopeActionOptions {
  /**
   * The logger instance to use for action logging.
   */
  logger: Logger

  /**
   * A name for this action, used as the scope's initial context.
   * Defaults to `'serverAction'`.
   */
  actionName?: string

  /**
   * Use `withContext()` to propagate action context as implicit context.
   * Requires `contextLocalStorage` to be set in `configure()`.
   * Defaults to `true`.
   */
  implicitContext?: boolean
}

/**
 * Wraps a Next.js Server Action with automatic scoped wide event logging.
 * Creates a scope when the action is invoked and emits a single structured
 * log event when it completes.
 *
 * @example
 * ```typescript
 * // app/actions.ts
 * 'use server'
 * import { createLogger } from 'logscope'
 * import { withLogscopeAction } from '@logscope/next'
 *
 * const log = createLogger(['my-app', 'actions'])
 *
 * export const submitForm = withLogscopeAction(
 *   { logger: log, actionName: 'submitForm' },
 *   async (logscope, formData: FormData) => {
 *     const email = formData.get('email') as string
 *     logscope.scope.set({ user: { email } })
 *     // ... process form
 *     return { success: true }
 *   },
 * )
 * ```
 */
export function withLogscopeAction<TArgs extends unknown[], TReturn>(
  options: LogscopeActionOptions,
  action: (logscope: LogscopeContext, ...args: TArgs) => TReturn | Promise<TReturn>,
): (...args: TArgs) => Promise<TReturn> {
  const {
    logger,
    actionName = 'serverAction',
    implicitContext = true,
  } = options

  return async (...args: TArgs): Promise<TReturn> => {
    const scope = logger.scope({ action: actionName })

    const requestLogger = logger.with({ action: actionName })

    const logscopeCtx: LogscopeContext = {
      scope,
      requestLogger,
      requestId: undefined,
    }

    const run = async (): Promise<TReturn> => {
      try {
        const result = await action(logscopeCtx, ...args)
        scope.emit()
        return result
      } catch (err) {
        scope.error(err instanceof Error ? err : new Error(String(err)))
        scope.emit()
        throw err
      }
    }

    if (implicitContext) {
      return withContext({ action: actionName }, run)
    }

    return run()
  }
}
