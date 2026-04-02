import type { H3Event } from 'h3'
import { getMethod, getRequestURL, getResponseStatus } from 'h3'
import type { Logger, Scope } from 'logscope'

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
  generateRequestId?: (event: H3Event) => string | undefined

  /**
   * Extract initial scope context from the request.
   * Called at the start of each request to seed the scope.
   *
   * Defaults to `{ method, path }`.
   */
  getRequestContext?: (event: H3Event) => Record<string, unknown>

  /**
   * Extract response context to merge before emitting.
   * Called after the handler completes.
   *
   * Defaults to `{ response: { status } }`.
   */
  getResponseContext?: (event: H3Event) => Record<string, unknown>
}

export interface LogscopeContext {
  scope: Scope
  requestLogger: Logger
  requestId: string | undefined
}

// Augment H3EventContext so that event.context.logscope is typed
declare module 'h3' {
  interface H3EventContext {
    logscope?: LogscopeContext
  }
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

function defaultGenerateRequestId(_event: H3Event): string | undefined {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return undefined
}

function defaultGetRequestContext(event: H3Event): Record<string, unknown> {
  const url = getRequestURL(event)
  return {
    method: getMethod(event),
    path: url.pathname,
  }
}

function defaultGetResponseContext(event: H3Event): Record<string, unknown> {
  return {
    response: {
      status: getResponseStatus(event),
    },
  }
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

/**
 * Creates a Nitro plugin that instruments each request with logscope.
 *
 * Usage in a Nitro plugin file (e.g. `server/plugins/logscope.ts`):
 *
 * ```ts
 * import { logscope } from '@logscope/nitro'
 * import { createLogger } from 'logscope'
 *
 * const logger = createLogger('my-app')
 *
 * export default defineNitroPlugin(logscope({ logger }))
 * ```
 *
 * Inside route handlers, access the scope via `event.context.logscope`:
 *
 * ```ts
 * export default defineEventHandler((event) => {
 *   const { scope, requestLogger } = event.context.logscope!
 *   scope.set({ user: { id: '123' } })
 *   requestLogger.info('handling request')
 *   return { ok: true }
 * })
 * ```
 *
 * **Note on implicit context:** Nitro plugin hooks run outside the handler's
 * async context, so AsyncLocalStorage-based `withContext()` is not supported
 * here. Use `event.context.logscope` for explicit access instead, or wrap
 * your route handlers with `withContext()` directly.
 */
export function logscope(options: LogscopeOptions) {
  const {
    logger,
    generateRequestId = defaultGenerateRequestId,
    getRequestContext = defaultGetRequestContext,
    getResponseContext = defaultGetResponseContext,
  } = options

  // Returns a function matching the shape expected by defineNitroPlugin:
  // (nitroApp: NitroApp) => void
  //
  // We accept `nitroApp` as `{ hooks: { hook: Function } }` to avoid
  // requiring nitropack as a dependency — the user's `defineNitroPlugin`
  // call provides the full NitroApp type.
  return (nitroApp: {
    hooks: {
      hook: (name: string, handler: (...args: unknown[]) => void) => void
    }
  }) => {
    nitroApp.hooks.hook('request', (event: H3Event) => {
      const requestId = generateRequestId(event)
      const requestContext = getRequestContext(event)

      const initialContext: Record<string, unknown> = { ...requestContext }
      if (requestId !== undefined) {
        initialContext.requestId = requestId
      }

      const scope = logger.scope(initialContext)

      const requestLogger =
        requestId !== undefined ? logger.with({ requestId }) : logger

      event.context.logscope = { scope, requestLogger, requestId }
    })

    nitroApp.hooks.hook(
      'afterResponse',
      (event: H3Event) => {
        const ctx = event.context.logscope
        if (!ctx) return

        const responseContext = getResponseContext(event)
        ctx.scope.emit(responseContext)
      },
    )

    nitroApp.hooks.hook(
      'error',
      (error: Error, context: { event?: H3Event }) => {
        if (context.event?.context.logscope) {
          context.event.context.logscope.scope.error(error)
        }
      },
    )
  }
}
