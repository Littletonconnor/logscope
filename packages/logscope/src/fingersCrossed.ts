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
 * Options for {@link fingersCrossed}.
 */
export interface FingersCrossedOptions {
  /**
   * Log level at or above which the buffer is flushed and the trigger fires.
   * Default: `"error"`.
   */
  triggerLevel?: LogLevel
  /**
   * Maximum number of records to buffer before the trigger fires.
   * When exceeded, the oldest records are silently dropped.
   * Default: `1000`.
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
}

/**
 * Creates a "fingers crossed" sink that silently buffers log records until a
 * record at or above the `triggerLevel` arrives. When triggered, the entire
 * buffer is flushed to the wrapped `sink`, followed by the trigger record
 * itself.
 *
 * This is useful in production when you want debug-level context only when
 * an error actually occurs — quiet normal operation, full context on failure.
 *
 * @example
 * ```typescript
 * const sink = fingersCrossed(getConsoleSink(), {
 *   triggerLevel: 'error',
 *   bufferSize: 500,
 * })
 * ```
 */
export function fingersCrossed(sink: Sink, options: FingersCrossedOptions = {}): Sink {
  const triggerLevel: LogLevel = options.triggerLevel ?? 'error'
  const maxBufferSize = options.bufferSize ?? 1000
  const afterTrigger: AfterTriggerBehavior = options.afterTrigger ?? 'passthrough'

  const buffer: LogRecord[] = []
  let triggered = false

  return (record: LogRecord) => {
    const isAtOrAboveTrigger = compareLogLevel(record.level, triggerLevel) >= 0

    // In passthrough mode after a trigger, forward everything directly
    if (triggered && afterTrigger === 'passthrough') {
      sink(record)
      return
    }

    if (isAtOrAboveTrigger) {
      // Flush the buffer, then forward the trigger record
      for (const buffered of buffer) {
        sink(buffered)
      }
      buffer.length = 0
      sink(record)

      if (afterTrigger === 'passthrough') {
        triggered = true
      }
      // 'reset' mode: buffer is cleared, triggered stays false, buffering resumes
      return
    }

    // Below trigger level — buffer the record
    buffer.push(record)

    // Evict oldest if over capacity
    if (buffer.length > maxBufferSize) {
      buffer.shift()
    }
  }
}
