import type { LogLevel } from './level.ts'
import type { LogRecord } from './record.ts'
import type { Filter } from './filter.ts'
import type { Sink } from './sink.ts'
import type { Scope } from './scope.ts'
import { compareLogLevel } from './level.ts'
import { createScope } from './scope.ts'
import { getImplicitContext, getCategoryPrefix } from './context.ts'

const ROOT_KEY = Symbol.for('logscope.rootLogger')

/**
 * Set of LoggerImpl nodes that have been configured with sinks/filters.
 * Strong references prevent GC from collecting configured loggers.
 * @internal
 */
export const strongRefs: Set<LoggerImpl> = new Set()

/**
 * Internal tree node that holds sinks, filters, children, and a parent pointer.
 * Not exposed publicly — users interact via the {@link Logger} interface.
 * @internal
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

  /**
   * Gets or creates a child LoggerImpl for the given subcategory.
   * Children are stored as WeakRefs to avoid memory leaks in long-running
   * processes. Configured loggers are kept alive via {@link strongRefs}.
   */
  getChild(subcategory: string): LoggerImpl {
    const existing = this.children[subcategory]

    if (existing != null) {
      if (existing instanceof WeakRef) {
        const derefed = existing.deref()
        if (derefed != null) return derefed
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

  /**
   * Walks up the tree yielding sinks applicable for the given log level.
   * Parent sinks come first unless parentSinks is "override".
   */
  *getSinks(level: LogLevel): Iterable<Sink> {
    if (
      this.lowestLevel !== null &&
      compareLogLevel(level, this.lowestLevel) < 0
    ) {
      return
    }

    if (this.parent && this.parentSinks === 'inherit') {
      yield* this.parent.getSinks(level)
    }

    yield* this.sinks
  }

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
    return true
  }

  /**
   * Dispatches a record to all applicable sinks. Sink errors are caught
   * and logged to the meta logger. A bypassSinks set prevents infinite
   * recursion when the meta logger's own sinks fail.
   */
  emit(record: LogRecord, bypassSinks?: Set<Sink>): void {
    if (!this.filter(record)) return

    for (const sink of this.getSinks(record.level)) {
      if (bypassSinks?.has(sink)) continue

      try {
        sink(record)
      } catch (error) {
        this.logSinkError(error, sink, record, bypassSinks)
      }
    }
  }

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

  /** Recursively clears sinks and filters from this node and all descendants. */
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
          delete this.children[key]
        }
      } else {
        child.resetDescendants()
      }
    }
  }

  /**
   * Returns the singleton root LoggerImpl.
   * Uses Symbol.for to ensure a single root across multiple copies of the library.
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

  /** Navigates from root to create/find the LoggerImpl for a category path. */
  static getLogger(category: readonly string[]): LoggerImpl {
    let node = LoggerImpl.getRoot()
    for (const part of category) {
      node = node.getChild(part)
    }
    return node
  }
}

/**
 * The public logger interface. Provides log methods at each level,
 * child logger creation, contextual wrappers, and scope creation.
 */
export interface Logger {
  /** The logger's category path. */
  readonly category: readonly string[]

  /** Log at trace level. */
  trace(message: string, properties?: Record<string, unknown>): void
  trace(properties: Record<string, unknown>): void

  /** Log at debug level. */
  debug(message: string, properties?: Record<string, unknown>): void
  debug(properties: Record<string, unknown>): void

  /** Log at info level. */
  info(message: string, properties?: Record<string, unknown>): void
  info(properties: Record<string, unknown>): void

  /** Log at warning level. */
  warning(message: string, properties?: Record<string, unknown>): void
  warning(properties: Record<string, unknown>): void

  /** Alias for {@link Logger.warning | warning}. */
  warn(message: string, properties?: Record<string, unknown>): void
  warn(properties: Record<string, unknown>): void

  /** Log at error level. */
  error(message: string, properties?: Record<string, unknown>): void
  error(properties: Record<string, unknown>): void

  /** Log at fatal level. */
  fatal(message: string, properties?: Record<string, unknown>): void
  fatal(properties: Record<string, unknown>): void

  /** Create a child logger with an additional subcategory segment. */
  child(subcategory: string): Logger

  /** Create a contextual wrapper that attaches properties to all logs. */
  with(properties: Record<string, unknown>): Logger

  /** Create a scoped wide event that accumulates context and emits once. */
  scope(initialContext?: Record<string, unknown>): Scope

  /** Returns true if any sinks would receive a record at the given level. */
  isEnabledFor(level: LogLevel): boolean
}

/**
 * A thin wrapper around a LoggerImpl that merges extra properties into
 * every log record. Created by {@link Logger.with}.
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

  scope(initialContext?: Record<string, unknown>): Scope {
    return createScope(this.impl, initialContext, this.properties)
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
    let messageProps: Record<string, unknown>

    if (typeof messageOrProps === 'string') {
      message = [messageOrProps]
      rawMessage = messageOrProps
      messageProps = properties ?? {}
    } else {
      message = []
      rawMessage = ''
      messageProps = messageOrProps
    }

    const implicitCtx = getImplicitContext()
    const mergedProps = implicitCtx
      ? { ...implicitCtx, ...this.properties, ...messageProps }
      : { ...this.properties, ...messageProps }

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

/**
 * Default Logger implementation backed by a LoggerImpl tree node.
 * Created by {@link createLogger}.
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

  scope(initialContext?: Record<string, unknown>): Scope {
    return createScope(this.impl, initialContext)
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
    let messageProps: Record<string, unknown>

    if (typeof messageOrProps === 'string') {
      message = [messageOrProps]
      rawMessage = messageOrProps
      messageProps = properties ?? {}
    } else {
      message = []
      rawMessage = ''
      messageProps = messageOrProps
    }

    const implicitCtx = getImplicitContext()
    const mergedProps = implicitCtx
      ? { ...implicitCtx, ...messageProps }
      : messageProps

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

/**
 * Creates a logger for the given category.
 *
 * When logscope is not configured, all logging calls produce zero output,
 * zero errors, and zero side effects — safe for library authors to use.
 * Multiple calls with the same category share the same internal tree node.
 *
 * @param category - A string (`"my-app"`) or array (`["my-app", "db"]`).
 */
export function createLogger(category: string | readonly string[]): Logger {
  const parts = typeof category === 'string' ? [category] : [...category]
  const prefix = getCategoryPrefix()
  const fullCategory = prefix ? [...prefix, ...parts] : parts
  const impl = LoggerImpl.getLogger(fullCategory)
  return new DefaultLogger(impl)
}
