import type { LogLevel } from './level.ts'
import type { LogRecord } from './record.ts'
import type { LoggerImpl } from './logger.ts'
import { getImplicitContext } from './context.ts'

// ---------------------------------------------------------------------------
// Scope – accumulate-then-emit wide events (AD-9)
// ---------------------------------------------------------------------------

/**
 * A scope accumulates structured context over a unit of work (e.g., an HTTP
 * request) and emits a single wide event at the end. This combines logtape's
 * library-first architecture with evlog's wide event model.
 */
export interface Scope {
  /** Deep-merge data into the accumulated context (new values win) */
  set(data: Record<string, unknown>): void

  /** Record an error — sets the scope level to error on emit */
  error(error: Error | string, context?: Record<string, unknown>): void

  /** Record a warning — sets the scope level to warning on emit (if no error) */
  warn(message: string, context?: Record<string, unknown>): void

  /** Record an informational sub-event */
  info(message: string, context?: Record<string, unknown>): void

  /** Emit the accumulated wide event as a single LogRecord */
  emit(overrides?: Record<string, unknown>): void

  /** Returns a snapshot (clone) of the current accumulated context */
  getContext(): Record<string, unknown>
}

// ---------------------------------------------------------------------------
// deepMerge – recursive merge where source wins (AD-9)
// ---------------------------------------------------------------------------

/**
 * Deep-merges `source` into `target`, returning a new object.
 * - Primitive values: source wins
 * - Arrays: source replaces (no concatenation)
 * - Objects: recursively merged
 * - null/undefined in source: skipped (don't overwrite with nothing)
 */
export function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target }

  for (const key of Object.keys(source)) {
    const sourceVal = source[key]

    // Skip null/undefined — don't overwrite existing data with nothing
    if (sourceVal == null) continue

    const targetVal = result[key]

    if (
      isPlainObject(sourceVal) &&
      isPlainObject(targetVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      )
    } else {
      result[key] = sourceVal
    }
  }

  return result
}

function isPlainObject(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  if (Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value) as unknown
  return proto === Object.prototype || proto === null
}

// ---------------------------------------------------------------------------
// ScopeImpl – internal implementation
// ---------------------------------------------------------------------------

/** A sub-event recorded within a scope via .info(), .warn(), or .error() */
interface ScopeLog {
  level: LogLevel
  message: string
  context?: Record<string, unknown>
  timestamp: number
}

/**
 * Creates a Scope that accumulates context and emits through the given
 * LoggerImpl. Called internally by Logger.scope().
 */
export function createScope(
  impl: LoggerImpl,
  initialContext?: Record<string, unknown>,
  loggerProperties?: Record<string, unknown>,
): Scope {
  let context: Record<string, unknown> = initialContext ? { ...initialContext } : {}
  const startTime = Date.now()
  let hasError = false
  let hasWarn = false
  const requestLogs: ScopeLog[] = []

  return {
    set(data: Record<string, unknown>): void {
      context = deepMerge(context, data)
    },

    error(error: Error | string, ctx?: Record<string, unknown>): void {
      hasError = true

      const errorData: Record<string, unknown> = {}
      if (error instanceof Error) {
        errorData.error = {
          name: error.name,
          message: error.message,
          stack: error.stack,
          ...(error.cause != null ? { cause: error.cause } : {}),
        }
      } else {
        errorData.error = { message: error }
      }

      if (ctx) {
        Object.assign(errorData, ctx)
      }

      context = deepMerge(context, errorData)

      const message = error instanceof Error ? error.message : error
      requestLogs.push({
        level: 'error',
        message,
        context: ctx,
        timestamp: Date.now(),
      })
    },

    warn(message: string, ctx?: Record<string, unknown>): void {
      hasWarn = true
      if (ctx) {
        context = deepMerge(context, ctx)
      }
      requestLogs.push({
        level: 'warning',
        message,
        context: ctx,
        timestamp: Date.now(),
      })
    },

    info(message: string, ctx?: Record<string, unknown>): void {
      if (ctx) {
        context = deepMerge(context, ctx)
      }
      requestLogs.push({
        level: 'info',
        message,
        context: ctx,
        timestamp: Date.now(),
      })
    },

    emit(overrides?: Record<string, unknown>): void {
      const duration = Date.now() - startTime

      // Determine level: error > warning > info
      let level: LogLevel = 'info'
      if (hasError) level = 'error'
      else if (hasWarn) level = 'warning'

      // Build final properties
      // Priority: implicit context (lowest) < logger .with() < scope context (highest)
      const implicitCtx = getImplicitContext()
      let properties: Record<string, unknown> = {
        ...(implicitCtx ?? {}),
        ...(loggerProperties ?? {}),
        ...context,
        duration,
      }

      if (requestLogs.length > 0) {
        properties.requestLogs = requestLogs.map((log) => ({ ...log }))
      }

      if (overrides) {
        properties = deepMerge(properties, overrides)
      }

      const record: LogRecord = {
        category: impl.category,
        level,
        timestamp: Date.now(),
        message: [],
        rawMessage: '',
        properties,
      }

      impl.emit(record)
    },

    getContext(): Record<string, unknown> {
      return JSON.parse(JSON.stringify(context)) as Record<string, unknown>
    },
  }
}
