import type { LogRecord } from './record.ts'
import type { LogLevel } from './level.ts'
import type { Filter, FilterLike } from './filter.ts'
import { toFilter } from './filter.ts'

/**
 * A sink receives log records and outputs them somewhere.
 * The simplest possible contract — just a function.
 */
export type Sink = (record: LogRecord) => void

/**
 * Options for the console sink.
 */
export interface ConsoleSinkOptions {
  /**
   * A formatter that converts a LogRecord into a string for console output.
   * If not provided, a simple default format is used.
   */
  formatter?: (record: LogRecord) => string
}

/**
 * Maps log levels to their corresponding console methods.
 */
const levelToConsoleMethod: Record<LogLevel, 'debug' | 'info' | 'warn' | 'error'> = {
  trace: 'debug',
  debug: 'debug',
  info: 'info',
  warning: 'warn',
  error: 'error',
  fatal: 'error',
}

/**
 * Default formatter that produces a simple readable string from a LogRecord.
 * Format: "TIMESTAMP [LEVEL] category: message {properties}"
 */
function defaultFormatter(record: LogRecord): string {
  const timestamp = new Date(record.timestamp).toISOString()
  const level = record.level.toUpperCase()
  const category = record.category.join(' · ')

  // Render the interleaved message array into a string
  const message = record.message
    .map((part) => (typeof part === 'string' ? part : String(part)))
    .join('')

  // Format properties if any exist
  const propKeys = Object.keys(record.properties)
  const props = propKeys.length > 0 ? ` ${JSON.stringify(record.properties)}` : ''

  const messagePart = message ? `: ${message}` : ''

  return `${timestamp} [${level}] ${category}${messagePart}${props}`
}

/**
 * Creates a sink that outputs to the console, mapping log levels to the
 * appropriate console method (debug, info, warn, error).
 *
 * Accepts an optional formatter to control the output format.
 * When no formatter is provided, a simple default format is used.
 */
export function getConsoleSink(options?: ConsoleSinkOptions): Sink {
  const formatter = options?.formatter ?? defaultFormatter

  return (record: LogRecord) => {
    const method = levelToConsoleMethod[record.level]
    const output = formatter(record)
    // eslint-disable-next-line no-console
    console[method](output)
  }
}

/**
 * Wraps a sink with a filter, creating a new sink that only forwards
 * records that pass the filter predicate.
 */
export function withFilter(sink: Sink, filter: FilterLike): Sink {
  const filterFn = toFilter(filter)
  return (record: LogRecord) => {
    if (filterFn(record)) {
      sink(record)
    }
  }
}
