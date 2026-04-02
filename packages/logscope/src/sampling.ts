import type { LogRecord } from './record.ts'
import type { Filter } from './filter.ts'
import type { LogLevel } from './level.ts'

/**
 * A tail-sampling condition that force-keeps a record regardless of
 * head-sampling probability.
 */
export type TailCondition = (record: LogRecord) => boolean

/**
 * Options for {@link createSamplingFilter}.
 */
export interface SamplingFilterOptions {
  /**
   * Head sampling rates per log level. Each value is a probability from
   * 0 (drop all) to 1 (keep all). Levels not listed default to 1 (keep all).
   *
   * @example
   * ```typescript
   * // Keep 10% of trace, 50% of debug, all info+
   * rates: { trace: 0.1, debug: 0.5 }
   * ```
   */
  rates?: Partial<Record<LogLevel, number>>
  /**
   * Tail-sampling conditions. If **any** condition returns `true`, the
   * record is kept regardless of head-sampling rates. Tail conditions
   * are checked **before** head sampling.
   *
   * @example
   * ```typescript
   * keepWhen: [
   *   (r) => (r.properties.status as number) >= 500,
   *   (r) => (r.properties.duration as number) >= 1000,
   * ]
   * ```
   */
  keepWhen?: TailCondition[]
  /**
   * Custom random function returning a number in [0, 1).
   * Defaults to `Math.random`. Useful for deterministic testing.
   */
  random?: () => number
}

/**
 * Creates a sampling {@link Filter} that combines probabilistic head
 * sampling with deterministic tail sampling.
 *
 * **Tail sampling** is checked first: if any `keepWhen` condition matches,
 * the record is kept immediately without consulting head-sampling rates.
 *
 * **Head sampling** uses per-level probabilities. A record at a given level
 * is kept with the probability specified in `rates` (defaulting to 1).
 */
export function createSamplingFilter(options: SamplingFilterOptions = {}): Filter {
  const rates = options.rates ?? {}
  const keepWhen = options.keepWhen ?? []
  const random = options.random ?? Math.random

  return (record: LogRecord): boolean => {
    // Tail sampling checked first — force-keep if any condition matches
    for (const condition of keepWhen) {
      if (condition(record)) {
        return true
      }
    }

    // Head sampling — probabilistic per-level
    const rate = rates[record.level] ?? 1
    if (rate >= 1) return true
    if (rate <= 0) return false
    return random() < rate
  }
}
