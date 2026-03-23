import type { LogRecord } from './record.ts'
import { inspect } from './util.ts'

/**
 * A formatter transforms a LogRecord into a string representation.
 */
export type TextFormatter = (record: LogRecord) => string

/**
 * Renders the interleaved message array into a plain string.
 * Strings at even indices are used as-is, values at odd indices
 * are converted via inspect().
 */
export function renderMessage(record: LogRecord): string {
  if (record.message.length === 0) return record.rawMessage
  return record.message
    .map((part, i) => (i % 2 === 0 ? String(part) : inspect(part)))
    .join('')
}

/**
 * Options for the text formatter.
 */
export interface TextFormatterOptions {
  /**
   * Separator between category segments.
   * @default " · "
   */
  categorySeparator?: string
  /**
   * Whether to include the timestamp.
   * @default true
   */
  timestamp?: boolean
}

/**
 * Creates a text formatter that produces human-readable output.
 *
 * Default format:
 *   2024-01-15T10:30:00.000Z [INFO] my-app · db: query executed {table: "users", ms: 42}
 */
export function getTextFormatter(options?: TextFormatterOptions): TextFormatter {
  const separator = options?.categorySeparator ?? ' \u00b7 '
  const showTimestamp = options?.timestamp ?? true

  return (record: LogRecord): string => {
    const parts: string[] = []

    if (showTimestamp) {
      parts.push(new Date(record.timestamp).toISOString())
    }

    parts.push(`[${record.level.toUpperCase()}]`)

    if (record.category.length > 0) {
      parts.push(record.category.join(separator))
    }

    let line = parts.join(' ')

    const message = renderMessage(record)
    if (message) {
      line += ': ' + message
    }

    const propKeys = Object.keys(record.properties)
    if (propKeys.length > 0) {
      line += ' ' + formatProperties(record.properties)
    }

    return line
  }
}

/**
 * Format properties as a compact readable string: {key: value, key2: value2}
 */
function formatProperties(properties: Record<string, unknown>): string {
  const entries = Object.entries(properties)
    .map(([key, value]) => `${key}: ${inspect(value)}`)
    .join(', ')
  return `{${entries}}`
}

/**
 * Options for the JSON formatter.
 */
export interface JsonFormatterOptions {
  /**
   * Separator between category segments in the "logger" field.
   * @default "."
   */
  categorySeparator?: string
}

/**
 * Creates a formatter that produces NDJSON (one JSON object per line).
 *
 * Output format:
 *   {"@timestamp":"...","level":"INFO","logger":"my-app.db","message":"...","properties":{...}}
 */
export function getJsonFormatter(options?: JsonFormatterOptions): TextFormatter {
  const separator = options?.categorySeparator ?? '.'

  return (record: LogRecord): string => {
    const obj: Record<string, unknown> = {
      '@timestamp': new Date(record.timestamp).toISOString(),
      level: record.level.toUpperCase(),
      logger: record.category.join(separator),
    }

    const message = renderMessage(record)
    if (message) {
      obj.message = message
    }

    const propKeys = Object.keys(record.properties)
    if (propKeys.length > 0) {
      obj.properties = serializeProperties(record.properties)
    }

    return JSON.stringify(obj)
  }
}

/**
 * Recursively serialize properties, handling Error objects specially.
 */
function serializeProperties(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(properties)) {
    result[key] = serializeValue(value)
  }
  return result
}

function serializeValue(value: unknown): unknown {
  if (value instanceof Error) {
    const err: Record<string, unknown> = {
      name: value.name,
      message: value.message,
    }
    if (value.stack) err.stack = value.stack
    if (value.cause !== undefined) err.cause = serializeValue(value.cause)
    return err
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return serializeProperties(value as Record<string, unknown>)
  }
  return value
}

// ANSI escape codes
const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'
const GRAY = '\x1b[90m'

const LEVEL_COLORS: Record<string, string> = {
  trace: GRAY,
  debug: CYAN,
  info: GREEN,
  warning: YELLOW,
  error: RED,
  fatal: RED + BOLD,
}

/**
 * Options for the ANSI color formatter.
 */
export interface AnsiColorFormatterOptions {
  /**
   * Separator between category segments.
   * @default " · "
   */
  categorySeparator?: string
}

/**
 * Creates a formatter with colored terminal output using raw ANSI escape codes.
 *
 * Level colors: trace=gray, debug=cyan, info=green, warning=yellow, error=red, fatal=red+bold
 * Timestamp in dim, category in bold.
 */
export function getAnsiColorFormatter(
  options?: AnsiColorFormatterOptions,
): TextFormatter {
  const separator = options?.categorySeparator ?? ' \u00b7 '

  return (record: LogRecord): string => {
    const timestamp = `${DIM}${new Date(record.timestamp).toISOString()}${RESET}`
    const levelColor = LEVEL_COLORS[record.level] ?? ''
    const level = `${levelColor}[${record.level.toUpperCase()}]${RESET}`
    const category =
      record.category.length > 0
        ? `${BOLD}${record.category.join(separator)}${RESET}`
        : ''

    let line = `${timestamp} ${level}`
    if (category) {
      line += ` ${category}`
    }

    const message = renderMessage(record)
    if (message) {
      line += ': ' + message
    }

    const propKeys = Object.keys(record.properties)
    if (propKeys.length > 0) {
      line += ` ${DIM}${formatProperties(record.properties)}${RESET}`
    }

    return line
  }
}
