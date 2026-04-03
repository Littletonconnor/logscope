import type { LogLevel } from './level.ts'
import type { LogRecord } from './record.ts'
import type { Filter, FilterLike } from './filter.ts'
import type { Sink } from './sink.ts'
import type { ContextLocalStorage } from './context.ts'
import { toFilter } from './filter.ts'
import { LoggerImpl, strongRefs } from './logger.ts'
import { getConsoleSink } from './sink.ts'
import { setContextLocalStorage, clearContextLocalStorage } from './context.ts'

/**
 * Error thrown when configuration is invalid or conflicts with existing state.
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

/**
 * Configuration for a single logger node in the tree.
 */
export interface LoggerConfig<
  TSinkId extends string = string,
  TFilterId extends string = string,
> {
  /** Category path for this logger (string or array of strings). */
  category: string | readonly string[]
  /** Which named sinks to attach. */
  sinks: TSinkId[]
  /** Which named filters to attach. */
  filters?: TFilterId[]
  /** Minimum log level for this logger (sets lowestLevel optimization). */
  level?: LogLevel
  /** Whether to inherit parent sinks or override them. */
  parentSinks?: 'inherit' | 'override'
}

/**
 * Top-level configuration object passed to {@link configure}.
 */
export interface Config<
  TSinkId extends string = string,
  TFilterId extends string = string,
> {
  /** Named sinks — keys are referenced by logger configs. */
  sinks: Record<TSinkId, Sink>
  /** Named filters — keys are referenced by logger configs. */
  filters?: Record<TFilterId, FilterLike>
  /** Logger configurations — wire categories to sinks and filters. */
  loggers: LoggerConfig<TSinkId, TFilterId>[]
  /**
   * Optional async context storage for implicit context propagation.
   * On Node.js, pass `new AsyncLocalStorage()` from `node:async_hooks`.
   * When omitted, {@link withContext} runs callbacks normally without context injection.
   */
  contextLocalStorage?: ContextLocalStorage<Record<string, unknown>>
  /** Allow reconfiguration when already configured (calls reset first). */
  reset?: boolean
}

let configured = false
const disposables: Array<() => void> = []

/**
 * Configures the logscope logger tree with sinks, filters, and logger rules.
 *
 * This is the entry point for application developers. Library authors should
 * never call this — they just use {@link createLogger} and let the app wire things up.
 *
 * @throws {ConfigError} If already configured without `config.reset: true`.
 * @throws {ConfigError} On duplicate categories or unknown sink/filter references.
 */
export async function configure<
  TSinkId extends string,
  TFilterId extends string,
>(config: Config<TSinkId, TFilterId>): Promise<void> {
  if (configured && !config.reset) {
    throw new ConfigError(
      'logscope is already configured. Pass { reset: true } to reconfigure, or call reset() first.',
    )
  }

  if (configured) {
    reset()
  }

  const resolvedFilters: Record<string, Filter> = {}
  if (config.filters) {
    for (const [id, filterLike] of Object.entries<FilterLike>(config.filters)) {
      resolvedFilters[id] = toFilter(filterLike)
    }
  }

  const seenCategories = new Set<string>()

  for (const loggerConfig of config.loggers) {
    const category =
      typeof loggerConfig.category === 'string'
        ? [loggerConfig.category]
        : loggerConfig.category

    const categoryKey = category.join('\0')
    if (seenCategories.has(categoryKey)) {
      throw new ConfigError(
        `Duplicate logger category: ${JSON.stringify([...category])}`,
      )
    }
    seenCategories.add(categoryKey)

    const impl = LoggerImpl.getLogger(category)

    for (const sinkId of loggerConfig.sinks) {
      const sink = config.sinks[sinkId]
      if (sink === undefined) {
        throw new ConfigError(
          `Logger [${[...category].join(', ')}] references unknown sink "${String(sinkId)}"`,
        )
      }
      impl.sinks.push(sink)
    }

    if (loggerConfig.filters) {
      for (const filterId of loggerConfig.filters) {
        const filter = resolvedFilters[String(filterId)]
        if (filter === undefined) {
          throw new ConfigError(
            `Logger [${[...category].join(', ')}] references unknown filter "${String(filterId)}"`,
          )
        }
        impl.filters.push(filter)
      }
    }

    if (loggerConfig.level) {
      impl.lowestLevel = loggerConfig.level
    }

    if (loggerConfig.parentSinks) {
      impl.parentSinks = loggerConfig.parentSinks
    }

    strongRefs.add(impl)
  }

  const metaCategoryKey = 'logscope\0meta'
  if (!seenCategories.has(metaCategoryKey)) {
    const metaImpl = LoggerImpl.getLogger(['logscope', 'meta'])
    metaImpl.sinks.push(getConsoleSink())
    strongRefs.add(metaImpl)
  }

  for (const sink of Object.values<Sink>(config.sinks)) {
    const disposable = getDisposeFn(sink)
    if (disposable) {
      disposables.push(disposable)
    }
  }

  setContextLocalStorage(config.contextLocalStorage)

  configured = true
}

/**
 * Resets all logscope configuration, returning all loggers to their silent
 * unconfigured state. Disposes any disposable sinks.
 */
export function reset(): void {
  const root = LoggerImpl.getRoot()
  root.resetDescendants()
  strongRefs.clear()

  for (const dispose of disposables) {
    try {
      dispose()
    } catch {
      // Swallow disposal errors during teardown
    }
  }
  disposables.length = 0

  clearContextLocalStorage()
  configured = false
}

/**
 * Alias for {@link reset}. Emphasizes resource cleanup semantics.
 */
export function dispose(): void {
  reset()
}

/**
 * Returns whether logscope has been configured.
 */
export function isConfigured(): boolean {
  return configured
}

/**
 * Extracts a dispose function from a sink if it implements
 * `Symbol.dispose` or has a `close()` method.
 */
function getDisposeFn(sink: Sink): (() => void) | null {
  const s = sink as unknown as Record<string | symbol, unknown>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const disposeSymbol = (Symbol as any).dispose as symbol | undefined
  if (disposeSymbol && typeof s[disposeSymbol] === 'function') {
    return () => (s[disposeSymbol] as () => void)()
  }
  if (typeof s['close'] === 'function') {
    return () => (s['close'] as () => void)()
  }
  return null
}
