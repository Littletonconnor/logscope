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
 *   (e.g., trigger on `"app.db"` also flushes `"app.db.queries"`)
 * - `"ancestors"` — also flush buffers that are prefixes of the trigger key
 *   (e.g., trigger on `"app.db"` also flushes `"app"`)
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
   * least-recently-used untriggered buffer is evicted (silently dropped).
   * Default: `1000`.
   */
  maxContexts?: number
  /**
   * When a trigger fires, which related buffers should also be flushed.
   * Uses prefix matching on buffer keys with the configured `separator`.
   * Default: `"exact"` (only the matching buffer).
   */
  flushRelated?: FlushRelated
  /**
   * Separator used for prefix matching in `"descendants"` / `"ancestors"` /
   * `"both"` flush modes. Default: `"."`.
   */
  separator?: string
}

/**
 * Options for {@link fingersCrossed}.
 */
export interface FingersCrossedOptions {
  /**
   * Log level at or above which the buffer is flushed and the trigger fires.
   * Default: `"error"`.
   */
  triggerLevel?: LogLevel
  /**
   * Maximum number of records to buffer per isolated context (or globally
   * when no isolation is configured). When exceeded, the oldest records are
   * silently dropped. Default: `1000`.
   */
  bufferSize?: number
  /**
   * What happens after the trigger fires.
   *
   * - `"passthrough"` (default) — all subsequent records are forwarded
   *   immediately without buffering.
   * - `"reset"` — the buffer is cleared and buffering resumes until the
   *   next trigger.
   */
  afterTrigger?: AfterTriggerBehavior
  /**
   * Isolate buffers by a key derived from each record. When set, each
   * unique key gets its own independent buffer. A trigger in one buffer
   * does not affect others.
   */
  isolation?: IsolationOptions
}

// ---------------------------------------------------------------------------
// Isolation helpers
// ---------------------------------------------------------------------------

/**
 * Creates isolation options that key buffers by the record's category.
 *
 * @param options.depth - How many category segments to use for the key.
 *   `undefined` (default) uses the full category. `1` groups by top-level
 *   category, `2` by the first two segments, etc.
 * @param options.flush - Which related category buffers to also flush on
 *   trigger. Default: `"exact"`.
 * @param options.maxContexts - Max isolated buffers. Default: `1000`.
 *
 * @example
 * ```typescript
 * // Separate buffer per exact category, flush descendants on trigger
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
 *   Default: `1000`.
 *
 * @example
 * ```typescript
 * // Per-request buffer — each requestId gets independent buffering
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

// ---------------------------------------------------------------------------
// Internal buffer context
// ---------------------------------------------------------------------------

interface BufferContext {
  records: LogRecord[]
  triggered: boolean
}

// ---------------------------------------------------------------------------
// Key matching
// ---------------------------------------------------------------------------

function shouldFlush(
  triggerKey: string,
  candidateKey: string,
  mode: FlushRelated,
  separator: string,
): boolean {
  if (triggerKey === candidateKey) return true
  if (mode === 'exact') return false

  const isDescendant =
    candidateKey.startsWith(triggerKey + separator)
  const isAncestor =
    triggerKey.startsWith(candidateKey + separator)

  if (mode === 'descendants') return isDescendant
  if (mode === 'ancestors') return isAncestor
  // 'both'
  return isDescendant || isAncestor
}

// ---------------------------------------------------------------------------
// LRU Map helpers
// ---------------------------------------------------------------------------

/** Move a key to the end of the Map (most recently used). */
function touch<V>(map: Map<string, V>, key: string): void {
  const value = map.get(key)
  if (value !== undefined) {
    map.delete(key)
    map.set(key, value)
  }
}

/** Evict the oldest untriggered context. If all are triggered, evict the oldest overall. */
function evictOldest(contexts: Map<string, BufferContext>): void {
  // Prefer evicting untriggered (they haven't been useful yet)
  for (const [key, ctx] of contexts) {
    if (!ctx.triggered) {
      contexts.delete(key)
      return
    }
  }
  // All triggered — evict the oldest
  const firstKey = contexts.keys().next().value
  if (firstKey !== undefined) {
    contexts.delete(firstKey)
  }
}

// ---------------------------------------------------------------------------
// Main implementation
// ---------------------------------------------------------------------------

/**
 * Creates a "fingers crossed" sink that silently buffers log records until a
 * record at or above the `triggerLevel` arrives. When triggered, the entire
 * buffer is flushed to the wrapped `sink`, followed by the trigger record
 * itself.
 *
 * This is useful in production when you want debug-level context only when
 * an error actually occurs — quiet normal operation, full context on failure.
 *
 * When `isolation` is configured, each unique key gets its own independent
 * buffer. A trigger in one buffer does not affect others. Use
 * {@link categoryIsolation} for per-category buffers or
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
 * // Per-category with descendant flushing
 * const sink = fingersCrossed(getConsoleSink(), {
 *   isolation: categoryIsolation({ flush: 'descendants' }),
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

  // -----------------------------------------------------------------------
  // Non-isolated mode (original behavior — single global buffer)
  // -----------------------------------------------------------------------
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

  // -----------------------------------------------------------------------
  // Isolated mode — separate buffer per key
  // -----------------------------------------------------------------------
  const keyFn = isolation.key
  const maxContexts = isolation.maxContexts ?? 1000
  const flushRelated: FlushRelated = isolation.flushRelated ?? 'exact'
  const separator = isolation.separator ?? '.'
  const contexts = new Map<string, BufferContext>()
  // Fallback buffer for records where key returns undefined
  const fallback: BufferContext = { records: [], triggered: false }

  function getOrCreate(key: string): BufferContext {
    let ctx = contexts.get(key)
    if (ctx) {
      touch(contexts, key)
      return ctx
    }

    // Evict if at capacity
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

    // Passthrough after trigger for this context
    if (ctx.triggered && afterTrigger === 'passthrough') {
      sink(record)
      return
    }

    if (isAtOrAboveTrigger) {
      // Flush the triggering context
      flushContext(ctx)
      sink(record)

      if (afterTrigger === 'passthrough') {
        ctx.triggered = true
      }

      // Flush related contexts if configured
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

    // Below trigger level — buffer the record
    bufferRecord(ctx, record)
  }
}
