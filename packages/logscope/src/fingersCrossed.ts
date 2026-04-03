import type { LogRecord } from './record.ts'
import type { LogLevel } from './level.ts'
import type { Sink } from './sink.ts'
import { compareLogLevel } from './level.ts'

/**
 * Behavior after the trigger level is reached.
 *
 * - `"passthrough"` — all subsequent records are forwarded directly (no more buffering)
 * - `"reset"` — the buffer is cleared and buffering resumes until the next trigger
 */
export type AfterTriggerBehavior = 'passthrough' | 'reset'

/**
 * Controls which related buffers are also flushed when a trigger fires,
 * using key prefix matching with a separator (default `"."`).
 *
 * - `"exact"` — only the buffer matching the trigger's key
 * - `"descendants"` — also flush buffers whose key starts with the trigger key
 * - `"ancestors"` — also flush buffers that are prefixes of the trigger key
 * - `"both"` — flush both descendants and ancestors
 */
export type FlushRelated = 'exact' | 'descendants' | 'ancestors' | 'both'

/**
 * Options for buffer isolation in {@link fingersCrossed}.
 * Maintains separate buffers keyed by a function of the record.
 */
export interface IsolationOptions {
  /**
   * Extract a buffer key from a record. Records with the same key share a
   * buffer. If the function returns `undefined`, the record is placed in
   * a fallback global buffer.
   */
  key: (record: LogRecord) => string | undefined
  /**
   * Maximum number of isolated buffers to maintain. When exceeded, the
   * least-recently-used untriggered buffer is evicted.
   * @default 1000
   */
  maxContexts?: number
  /**
   * When a trigger fires, which related buffers should also be flushed.
   * Uses prefix matching on buffer keys with the configured `separator`.
   * @default "exact"
   */
  flushRelated?: FlushRelated
  /**
   * Separator used for prefix matching in `"descendants"` / `"ancestors"` /
   * `"both"` flush modes.
   * @default "."
   */
  separator?: string
}

/**
 * Options for {@link fingersCrossed}.
 */
export interface FingersCrossedOptions {
  /**
   * Log level at or above which the buffer is flushed and the trigger fires.
   * @default "error"
   */
  triggerLevel?: LogLevel
  /**
   * Maximum number of records to buffer per isolated context (or globally
   * when no isolation is configured). Oldest records are dropped when exceeded.
   * @default 1000
   */
  bufferSize?: number
  /**
   * What happens after the trigger fires.
   * @default "passthrough"
   */
  afterTrigger?: AfterTriggerBehavior
  /**
   * Isolate buffers by a key derived from each record. When set, each
   * unique key gets its own independent buffer.
   */
  isolation?: IsolationOptions
}

/**
 * Creates isolation options that key buffers by the record's category.
 *
 * @param options.depth - How many category segments to use for the key.
 *   `undefined` (default) uses the full category.
 * @param options.flush - Which related category buffers to also flush on trigger.
 * @param options.maxContexts - Max isolated buffers.
 *
 * @example
 * ```typescript
 * fingersCrossed(sink, {
 *   isolation: categoryIsolation({ flush: 'descendants' }),
 * })
 * ```
 */
export function categoryIsolation(options?: {
  depth?: number
  flush?: FlushRelated
  maxContexts?: number
}): IsolationOptions {
  const depth = options?.depth
  const separator = '.'
  return {
    key: (record: LogRecord) => {
      const parts = depth !== undefined ? record.category.slice(0, depth) : record.category
      return parts.join(separator)
    },
    flushRelated: options?.flush ?? 'exact',
    maxContexts: options?.maxContexts,
    separator,
  }
}

/**
 * Creates isolation options that key buffers by a named property on the
 * record. Useful for per-request buffering (e.g., key by `requestId`).
 *
 * @param propertyName - The property to extract from `record.properties`.
 * @param options.maxContexts - Max isolated buffers before LRU eviction.
 *
 * @example
 * ```typescript
 * fingersCrossed(sink, {
 *   isolation: propertyIsolation('requestId', { maxContexts: 500 }),
 *   afterTrigger: 'reset',
 * })
 * ```
 */
export function propertyIsolation(
  propertyName: string,
  options?: { maxContexts?: number },
): IsolationOptions {
  return {
    key: (record: LogRecord) => {
      const value = record.properties[propertyName]
      return value !== undefined && value !== null ? String(value) : undefined
    },
    maxContexts: options?.maxContexts,
    flushRelated: 'exact',
  }
}

interface BufferContext {
  records: LogRecord[]
  triggered: boolean
}

function shouldFlush(
  triggerKey: string,
  candidateKey: string,
  mode: FlushRelated,
  separator: string,
): boolean {
  if (triggerKey === candidateKey) return true
  if (mode === 'exact') return false

  const isDescendant = candidateKey.startsWith(triggerKey + separator)
  const isAncestor = triggerKey.startsWith(candidateKey + separator)

  if (mode === 'descendants') return isDescendant
  if (mode === 'ancestors') return isAncestor
  return isDescendant || isAncestor
}

function touch<V>(map: Map<string, V>, key: string): void {
  const value = map.get(key)
  if (value !== undefined) {
    map.delete(key)
    map.set(key, value)
  }
}

function evictOldest(contexts: Map<string, BufferContext>): void {
  for (const [key, ctx] of contexts) {
    if (!ctx.triggered) {
      contexts.delete(key)
      return
    }
  }
  const firstKey = contexts.keys().next().value
  if (firstKey !== undefined) {
    contexts.delete(firstKey)
  }
}

/**
 * Creates a "fingers crossed" sink that silently buffers log records until a
 * record at or above the `triggerLevel` arrives. When triggered, the entire
 * buffer is flushed to the wrapped sink, followed by the trigger record itself.
 *
 * Useful in production when you want debug-level context only when an error
 * actually occurs — quiet normal operation, full context on failure.
 *
 * When `isolation` is configured, each unique key gets its own independent
 * buffer. Use {@link categoryIsolation} for per-category buffers or
 * {@link propertyIsolation} for per-request/context buffers.
 *
 * @example
 * ```typescript
 * // Simple global buffer
 * const sink = fingersCrossed(getConsoleSink(), {
 *   triggerLevel: 'error',
 *   bufferSize: 500,
 * })
 *
 * // Per-request with LRU eviction
 * const sink = fingersCrossed(getConsoleSink(), {
 *   isolation: propertyIsolation('requestId', { maxContexts: 500 }),
 *   afterTrigger: 'reset',
 * })
 * ```
 */
export function fingersCrossed(sink: Sink, options: FingersCrossedOptions = {}): Sink {
  const triggerLevel: LogLevel = options.triggerLevel ?? 'error'
  const maxBufferSize = options.bufferSize ?? 1000
  const afterTrigger: AfterTriggerBehavior = options.afterTrigger ?? 'passthrough'
  const isolation = options.isolation

  if (!isolation) {
    const buffer: LogRecord[] = []
    let triggered = false

    return (record: LogRecord) => {
      const isAtOrAboveTrigger = compareLogLevel(record.level, triggerLevel) >= 0

      if (triggered && afterTrigger === 'passthrough') {
        sink(record)
        return
      }

      if (isAtOrAboveTrigger) {
        for (const buffered of buffer) {
          sink(buffered)
        }
        buffer.length = 0
        sink(record)

        if (afterTrigger === 'passthrough') {
          triggered = true
        }
        return
      }

      buffer.push(record)
      if (buffer.length > maxBufferSize) {
        buffer.shift()
      }
    }
  }

  const keyFn = isolation.key
  const maxContexts = isolation.maxContexts ?? 1000
  const flushRelated: FlushRelated = isolation.flushRelated ?? 'exact'
  const separator = isolation.separator ?? '.'
  const contexts = new Map<string, BufferContext>()
  const fallback: BufferContext = { records: [], triggered: false }

  function getOrCreate(key: string): BufferContext {
    let ctx = contexts.get(key)
    if (ctx) {
      touch(contexts, key)
      return ctx
    }

    if (contexts.size >= maxContexts) {
      evictOldest(contexts)
    }

    ctx = { records: [], triggered: false }
    contexts.set(key, ctx)
    return ctx
  }

  function flushContext(ctx: BufferContext): void {
    for (const buffered of ctx.records) {
      sink(buffered)
    }
    ctx.records.length = 0
  }

  function bufferRecord(ctx: BufferContext, record: LogRecord): void {
    ctx.records.push(record)
    if (ctx.records.length > maxBufferSize) {
      ctx.records.shift()
    }
  }

  return (record: LogRecord) => {
    const key = keyFn(record)
    const ctx = key !== undefined ? getOrCreate(key) : fallback

    const isAtOrAboveTrigger = compareLogLevel(record.level, triggerLevel) >= 0

    if (ctx.triggered && afterTrigger === 'passthrough') {
      sink(record)
      return
    }

    if (isAtOrAboveTrigger) {
      flushContext(ctx)
      sink(record)

      if (afterTrigger === 'passthrough') {
        ctx.triggered = true
      }

      if (key !== undefined && flushRelated !== 'exact') {
        for (const [candidateKey, candidateCtx] of contexts) {
          if (candidateKey === key) continue
          if (shouldFlush(key, candidateKey, flushRelated, separator)) {
            flushContext(candidateCtx)
            if (afterTrigger === 'passthrough') {
              candidateCtx.triggered = true
            }
          }
        }
      }
      return
    }

    bufferRecord(ctx, record)
  }
}
