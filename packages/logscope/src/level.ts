/**
 * Log levels in order of increasing severity.
 */
export const logLevels = [
  'trace',
  'debug',
  'info',
  'warning',
  'error',
  'fatal',
] as const

/**
 * A log level string.
 */
export type LogLevel = (typeof logLevels)[number]

/**
 * Compares two log levels by severity.
 * Returns negative if `a` is less severe than `b`,
 * zero if equal, positive if `a` is more severe.
 */
export function compareLogLevel(a: LogLevel, b: LogLevel): number {
  return logLevels.indexOf(a) - logLevels.indexOf(b)
}

/**
 * Type guard that checks if a string is a valid LogLevel.
 */
export function isLogLevel(value: string): value is LogLevel {
  return (logLevels as readonly string[]).includes(value)
}

/**
 * Parses a string into a LogLevel (case-insensitive).
 * Throws if the string is not a valid level.
 */
export function parseLogLevel(value: string): LogLevel {
  const lower = value.toLowerCase()
  if (isLogLevel(lower)) return lower
  throw new TypeError(
    `Invalid log level: ${JSON.stringify(value)}. Expected one of: ${logLevels.join(', ')}`,
  )
}

/**
 * Returns a copy of the log levels array.
 */
export function getLogLevels(): LogLevel[] {
  return [...logLevels]
}
