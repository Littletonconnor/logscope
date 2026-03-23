import type { LogLevel } from './level.ts'

/**
 * A log record representing a single log event.
 * This is the core data structure that flows through
 * filters, sinks, and formatters.
 */
export interface LogRecord {
  /** The logger category path (e.g., ["my-app", "db"]) */
  readonly category: readonly string[]
  /** The severity level of this record */
  readonly level: LogLevel
  /** Timestamp in milliseconds (Date.now()) */
  readonly timestamp: number
  /**
   * Interleaved message parts: strings at even indices, values at odd indices.
   * Always odd length. E.g., ["Hello ", "Alice", ", you have ", 42, " items"]
   */
  readonly message: readonly unknown[]
  /** The original message template string */
  readonly rawMessage: string
  /** Structured key-value data attached to this record */
  readonly properties: Record<string, unknown>
}
