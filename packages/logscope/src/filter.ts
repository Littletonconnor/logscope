import type { LogRecord } from './record.ts'
import type { LogLevel } from './level.ts'
import { compareLogLevel } from './level.ts'

/**
 * A filter predicate that decides whether a log record should be emitted.
 * Returns `true` to allow the record, `false` to suppress it.
 */
export type Filter = (record: LogRecord) => boolean

/**
 * A convenient union for specifying filters.
 * - A `Filter` function is used as-is.
 * - A `LogLevel` string creates a level threshold filter.
 * - `null` rejects everything.
 */
export type FilterLike = Filter | LogLevel | null

/**
 * Returns a filter that accepts records at or above the given level.
 */
export function getLevelFilter(level: LogLevel): Filter {
  return (record: LogRecord) => compareLogLevel(record.level, level) >= 0
}

/**
 * Normalizes a `FilterLike` value into a `Filter` function.
 * - Function → returned as-is
 * - LogLevel string → level threshold filter
 * - `null` → rejects everything
 */
export function toFilter(filterLike: FilterLike): Filter {
  if (filterLike === null) return () => false
  if (typeof filterLike === 'function') return filterLike
  return getLevelFilter(filterLike)
}
