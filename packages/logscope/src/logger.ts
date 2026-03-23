import type { LogLevel } from './level.ts'
import type { LogRecord } from './record.ts'
import type { Filter } from './filter.ts'
import type { Sink } from './sink.ts'
import { compareLogLevel } from './level.ts'

// ---------------------------------------------------------------------------
// Globals – singleton root via Symbol.for (AD-1)
// ---------------------------------------------------------------------------

const ROOT_KEY = Symbol.for('logscope.rootLogger')

/**
 * Set of LoggerImpl nodes that have been configured with sinks/filters.
 * Strong references prevent GC from collecting configured loggers (AD-4).
 */
export const strongRefs: Set<LoggerImpl> = new Set()

// ---------------------------------------------------------------------------
// LoggerImpl – internal tree node (AD-2)
// ---------------------------------------------------------------------------

/**
 * Internal tree node that holds sinks, filters, children, and a parent pointer.
 * Not exposed publicly – users interact via Logger / LoggerCtx.
 */
export class LoggerImpl {
  readonly parent: LoggerImpl | null
  readonly category: readonly string[]
  readonly children: Record<string, LoggerImpl | WeakRef<LoggerImpl>> = {}
  readonly sinks: Sink[] = []
  readonly filters: Filter[] = []
  parentSinks: 'inherit' | 'override' = 'inherit'
  lowestLevel: LogLevel | null = null

  constructor(parent: LoggerImpl | null, category: readonly string[]) {
    this.parent = parent
    this.category = category
  }

  // ---- Child management (AD-4: WeakRef children) ----

  /**
   * Gets or creates a child LoggerImpl for the given subcategory.
   * Children are stored as WeakRefs to avoid memory leaks in long-running
   * processes. Configured loggers are kept alive via strongRefs.
   */
  getChild(subcategory: string): LoggerImpl {
    const existing = this.children[subcategory]

    if (existing != null) {
      // If WeakRef is available and used, deref it
      if (existing instanceof WeakRef) {
        const derefed = existing.deref()
        if (derefed != null) return derefed
        // WeakRef was collected – create a new child
      } else {
        return existing
      }
    }

    const child = new LoggerImpl(this, [...this.category, subcategory])

    if (typeof WeakRef !== 'undefined') {
      this.children[subcategory] = new WeakRef(child)
    } else {
      this.children[subcategory] = child
    }

    return child
  }

  // ---- Sink collection (AD-5: generator-based) ----

  /**
   * Generator that walks up the tree yielding sinks applicable for the
   * given log level. Parent sinks come first unless parentSinks is "override".
   */
  *getSinks(level: LogLevel): Iterable<Sink> {
    // Early exit: if this node's lowestLevel is above the record's level
    if (
      this.lowestLevel !== null &&
      compareLogLevel(level, this.lowestLevel) < 0
    ) {
      return
    }

    // Walk up: parent sinks first (unless overridden)
    if (this.parent && this.parentSinks === 'inherit') {
      yield* this.parent.getSinks(level)
    }

    // Then this node's own sinks
    yield* this.sinks
  }

  // ---- Filtering (AD-7: filter inheritance) ----

  /**
   * Checks whether a record passes filters. If this node has its own
   * filters, only those are checked. If it has none, it delegates to
   * its parent. If no filters exist anywhere, the record passes.
   */
  filter(record: LogRecord): boolean {
    if (this.filters.length > 0) {
      return this.filters.every((f) => f(record))
    }
    if (this.parent) {
      return this.parent.filter(record)
    }
    // No filters anywhere – allow everything
    return true
  }

  // ---- Emit (dispatches to sinks with error handling, AD-6) ----

  /**
   * Dispatches a record to all applicable sinks, with error handling.
   * Sink errors are caught and logged to the meta logger. A bypassSinks
   * set prevents infinite recursion when the meta logger's own sinks fail.
   */
  emit(record: LogRecord, bypassSinks?: Set<Sink>): void {
    // Check filters first
    if (!this.filter(record)) return

    for (const sink of this.getSinks(record.level)) {
      if (bypassSinks?.has(sink)) continue

      try {
        sink(record)
      } catch (error) {
        // Log sink errors to the meta logger (AD-6)
        this.logSinkError(error, sink, record, bypassSinks)
      }
    }
  }

  /**
   * Logs a sink error to the meta logger ["logscope", "meta"].
   * Uses bypassSinks to prevent infinite recursion.
   */
  private logSinkError(
    error: unknown,
    failingSink: Sink,
    originalRecord: LogRecord,
    existingBypass?: Set<Sink>,
  ): void {
    const metaLogger = LoggerImpl.getLogger(['logscope', 'meta'])
    const bypass = new Set(existingBypass)
    bypass.add(failingSink)

    const errorMessage =
      error instanceof Error ? error.message : String(error)

    const metaRecord: LogRecord = {
      category: ['logscope', 'meta'],
      level: 'error',
      timestamp: Date.now(),
      message: ['Sink error: ', errorMessage],
      rawMessage: 'Sink error: {error}',
      properties: {
        error,
        originalCategory: originalRecord.category,
        originalLevel: originalRecord.level,
      },
    }

    metaLogger.emit(metaRecord, bypass)
  }

  // ---- Reset (used by configure/reset) ----

  /**
   * Recursively clears sinks and filters from this node and all descendants.
   */
  resetDescendants(): void {
    this.sinks.length = 0
    this.filters.length = 0
    this.parentSinks = 'inherit'
    this.lowestLevel = null

    for (const key of Object.keys(this.children)) {
      const child = this.children[key]
      if (child instanceof WeakRef) {
        const derefed = child.deref()
        if (derefed) {
          derefed.resetDescendants()
        } else {
          // WeakRef was collected, clean up the entry
          delete this.children[key]
        }
      } else {
        child.resetDescendants()
      }
    }
  }

  // ---- Static: navigate the singleton tree ----

  /**
   * Returns the root LoggerImpl, creating it if needed.
   * Uses Symbol.for to ensure a single root across multiple copies (AD-1).
   */
  static getRoot(): LoggerImpl {
    const g = globalThis as Record<symbol, LoggerImpl | undefined>
    let root = g[ROOT_KEY]
    if (!root) {
      root = new LoggerImpl(null, [])
      g[ROOT_KEY] = root
    }
    return root
  }

  /**
   * Navigates from root to create/find the LoggerImpl for a category.
   */
  static getLogger(category: readonly string[]): LoggerImpl {
    let node = LoggerImpl.getRoot()
    for (const part of category) {
      node = node.getChild(part)
    }
    return node
  }
}

// ---------------------------------------------------------------------------
// Logger – public interface (AD-2)
// ---------------------------------------------------------------------------

/**
 * The public logger interface. Provides log methods at each level,
 * child logger creation, contextual wrappers, and scope creation.
 */
export interface Logger {
  /** The logger's category path */
  readonly category: readonly string[]

  /** Log at trace level */
  trace(message: string, properties?: Record<string, unknown>): void
  trace(properties: Record<string, unknown>): void

  /** Log at debug level */
  debug(message: string, properties?: Record<string, unknown>): void
  debug(properties: Record<string, unknown>): void

  /** Log at info level */
  info(message: string, properties?: Record<string, unknown>): void
  info(properties: Record<string, unknown>): void

  /** Log at warning level (alias: warn) */
  warning(message: string, properties?: Record<string, unknown>): void
  warning(properties: Record<string, unknown>): void

  /** Log at warning level (alias for warning) */
  warn(message: string, properties?: Record<string, unknown>): void
  warn(properties: Record<string, unknown>): void

  /** Log at error level */
  error(message: string, properties?: Record<string, unknown>): void
  error(properties: Record<string, unknown>): void

  /** Log at fatal level */
  fatal(message: string, properties?: Record<string, unknown>): void
  fatal(properties: Record<string, unknown>): void

  /** Create a child logger with an additional subcategory */
  child(subcategory: string): Logger

  /** Create a contextual wrapper that attaches properties to all logs */
  with(properties: Record<string, unknown>): Logger

  /** Check if any sinks exist for the given level */
  isEnabledFor(level: LogLevel): boolean
}

// ---------------------------------------------------------------------------
// LoggerCtx – contextual wrapper (AD-2)
// ---------------------------------------------------------------------------

/**
 * A thin wrapper around a LoggerImpl that merges extra properties into
 * every log record. Created by Logger.with().
 */
class LoggerCtx implements Logger {
  private readonly impl: LoggerImpl
  private readonly properties: Record<string, unknown>

  constructor(impl: LoggerImpl, properties: Record<string, unknown>) {
    this.impl = impl
    this.properties = properties
  }

  get category(): readonly string[] {
    return this.impl.category
  }

  trace(
    messageOrProps: string | Record<string, unknown>,
    properties?: Record<string, unknown>,
  ): void {
    this.log('trace', messageOrProps, properties)
  }

  debug(
    messageOrProps: string | Record<string, unknown>,
    properties?: Record<string, unknown>,
  ): void {
    this.log('debug', messageOrProps, properties)
  }

  info(
    messageOrProps: string | Record<string, unknown>,
    properties?: Record<string, unknown>,
  ): void {
    this.log('info', messageOrProps, properties)
  }

  warning(
    messageOrProps: string | Record<string, unknown>,
    properties?: Record<string, unknown>,
  ): void {
    this.log('warning', messageOrProps, properties)
  }

  warn(
    messageOrProps: string | Record<string, unknown>,
    properties?: Record<string, unknown>,
  ): void {
    this.log('warning', messageOrProps, properties)
  }

  error(
    messageOrProps: string | Record<string, unknown>,
    properties?: Record<string, unknown>,
  ): void {
    this.log('error', messageOrProps, properties)
  }

  fatal(
    messageOrProps: string | Record<string, unknown>,
    properties?: Record<string, unknown>,
  ): void {
    this.log('fatal', messageOrProps, properties)
  }

  child(subcategory: string): Logger {
    return new LoggerCtx(this.impl.getChild(subcategory), { ...this.properties })
  }

  with(properties: Record<string, unknown>): Logger {
    return new LoggerCtx(this.impl, { ...this.properties, ...properties })
  }

  isEnabledFor(level: LogLevel): boolean {
    // Check if any sinks would receive a record at this level
    for (const _sink of this.impl.getSinks(level)) {
      return true
    }
    return false
  }

  private log(
    level: LogLevel,
    messageOrProps: string | Record<string, unknown>,
    properties?: Record<string, unknown>,
  ): void {
    let message: readonly unknown[]
    let rawMessage: string
    let mergedProps: Record<string, unknown>

    if (typeof messageOrProps === 'string') {
      message = [messageOrProps]
      rawMessage = messageOrProps
      mergedProps = { ...this.properties, ...properties }
    } else {
      message = []
      rawMessage = ''
      mergedProps = { ...this.properties, ...messageOrProps }
    }

    const record: LogRecord = {
      category: this.impl.category,
      level,
      timestamp: Date.now(),
      message,
      rawMessage,
      properties: mergedProps,
    }

    this.impl.emit(record)
  }
}

// ---------------------------------------------------------------------------
// DefaultLogger – Logger backed directly by a LoggerImpl
// ---------------------------------------------------------------------------

/**
 * Default Logger implementation backed by a LoggerImpl tree node.
 * Created by createLogger().
 */
class DefaultLogger implements Logger {
  /** @internal */
  readonly impl: LoggerImpl

  constructor(impl: LoggerImpl) {
    this.impl = impl
  }

  get category(): readonly string[] {
    return this.impl.category
  }

  trace(
    messageOrProps: string | Record<string, unknown>,
    properties?: Record<string, unknown>,
  ): void {
    this.log('trace', messageOrProps, properties)
  }

  debug(
    messageOrProps: string | Record<string, unknown>,
    properties?: Record<string, unknown>,
  ): void {
    this.log('debug', messageOrProps, properties)
  }

  info(
    messageOrProps: string | Record<string, unknown>,
    properties?: Record<string, unknown>,
  ): void {
    this.log('info', messageOrProps, properties)
  }

  warning(
    messageOrProps: string | Record<string, unknown>,
    properties?: Record<string, unknown>,
  ): void {
    this.log('warning', messageOrProps, properties)
  }

  warn(
    messageOrProps: string | Record<string, unknown>,
    properties?: Record<string, unknown>,
  ): void {
    this.log('warning', messageOrProps, properties)
  }

  error(
    messageOrProps: string | Record<string, unknown>,
    properties?: Record<string, unknown>,
  ): void {
    this.log('error', messageOrProps, properties)
  }

  fatal(
    messageOrProps: string | Record<string, unknown>,
    properties?: Record<string, unknown>,
  ): void {
    this.log('fatal', messageOrProps, properties)
  }

  child(subcategory: string): Logger {
    return new DefaultLogger(this.impl.getChild(subcategory))
  }

  with(properties: Record<string, unknown>): Logger {
    return new LoggerCtx(this.impl, { ...properties })
  }

  isEnabledFor(level: LogLevel): boolean {
    for (const _sink of this.impl.getSinks(level)) {
      return true
    }
    return false
  }

  private log(
    level: LogLevel,
    messageOrProps: string | Record<string, unknown>,
    properties?: Record<string, unknown>,
  ): void {
    let message: readonly unknown[]
    let rawMessage: string
    let mergedProps: Record<string, unknown>

    if (typeof messageOrProps === 'string') {
      message = [messageOrProps]
      rawMessage = messageOrProps
      mergedProps = properties ?? {}
    } else {
      message = []
      rawMessage = ''
      mergedProps = messageOrProps
    }

    const record: LogRecord = {
      category: this.impl.category,
      level,
      timestamp: Date.now(),
      message,
      rawMessage,
      properties: mergedProps,
    }

    this.impl.emit(record)
  }
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Creates a logger for the given category.
 *
 * - String input → `["my-app"]`
 * - Array input → `["my-app", "db"]`
 *
 * When logscope is not configured, all logging calls produce zero output,
 * zero errors, and zero side effects — safe for library authors to use.
 *
 * Multiple calls with the same category share the same internal tree node.
 */
export function createLogger(category: string | readonly string[]): Logger {
  const parts = typeof category === 'string' ? [category] : category
  const impl = LoggerImpl.getLogger(parts)
  return new DefaultLogger(impl)
}
