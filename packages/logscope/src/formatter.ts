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
const WHITE = '\x1b[37m'

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

// ---------------------------------------------------------------------------
// Pretty Dev Formatter — tree-formatted wide event output
// ---------------------------------------------------------------------------

/**
 * Options for the pretty dev formatter.
 */
export interface PrettyFormatterOptions {
  /**
   * Separator between category segments.
   * @default " · "
   */
  categorySeparator?: string
  /**
   * Maximum depth for rendering nested objects in the tree.
   * @default 4
   */
  maxDepth?: number
}

/**
 * Renders an object value as a tree with box-drawing prefixes.
 * Each line is indented with the given prefix. Last items use `└── `,
 * others use `├── `, and continuation lines use `│   ` or `    `.
 */
function renderTree(
  obj: Record<string, unknown>,
  prefix: string,
  depth: number,
  maxDepth: number,
): string[] {
  const keys = Object.keys(obj)
  const lines: string[] = []

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    const value = obj[key]
    const isLast = i === keys.length - 1
    const connector = isLast ? '└── ' : '├── '
    const childPrefix = prefix + (isLast ? '    ' : '│   ')

    if (
      depth < maxDepth &&
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !(value instanceof Error) &&
      !(value instanceof Date) &&
      Object.keys(value as Record<string, unknown>).length > 0
    ) {
      lines.push(`${prefix}${connector}${DIM}${key}:${RESET}`)
      lines.push(
        ...renderTree(
          value as Record<string, unknown>,
          childPrefix,
          depth + 1,
          maxDepth,
        ),
      )
    } else {
      const rendered = renderPrettyValue(value)
      lines.push(`${prefix}${connector}${DIM}${key}:${RESET} ${rendered}`)
    }
  }

  return lines
}

/**
 * Renders a value for pretty output — keeps primitives readable,
 * uses inspect() for complex leaf values.
 */
function renderPrettyValue(value: unknown): string {
  if (value === null) return `${DIM}null${RESET}`
  if (value === undefined) return `${DIM}undefined${RESET}`
  if (typeof value === 'string') return `${WHITE}${value}${RESET}`
  if (typeof value === 'number') return `${CYAN}${value}${RESET}`
  if (typeof value === 'boolean') return `${YELLOW}${value}${RESET}`
  if (value instanceof Error) {
    const parts = [`${RED}${value.name}: ${value.message}${RESET}`]
    if (value.stack) {
      const stackLines = value.stack.split('\n').slice(1, 4)
      for (const line of stackLines) {
        parts.push(`${DIM}${line.trim()}${RESET}`)
      }
    }
    return parts.join('\n')
  }
  if (Array.isArray(value)) return inspect(value)
  return inspect(value)
}

/**
 * Creates a pretty formatter for dev-friendly terminal output.
 *
 * Renders wide events (scope emits with many properties) as a visual tree
 * with box-drawing characters (`├──`, `└──`). Regular log messages get
 * colored output similar to {@link getAnsiColorFormatter} but with the
 * properties rendered as an indented tree below the header line.
 *
 * Best used in development. For production, prefer {@link getJsonFormatter}.
 *
 * @example
 * ```ts
 * configure({
 *   sinks: { console: getConsoleSink({ formatter: getPrettyFormatter() }) },
 *   loggers: [{ category: 'app', sinks: ['console'], level: 'debug' }],
 * })
 * ```
 */
export function getPrettyFormatter(
  options?: PrettyFormatterOptions,
): TextFormatter {
  const separator = options?.categorySeparator ?? ' · '
  const maxDepth = options?.maxDepth ?? 4

  return (record: LogRecord): string => {
    const levelColor = LEVEL_COLORS[record.level] ?? ''
    const levelTag = `${levelColor}${record.level.toUpperCase()}${RESET}`
    const timestamp = `${DIM}${new Date(record.timestamp).toISOString()}${RESET}`
    const category =
      record.category.length > 0
        ? ` ${BOLD}${record.category.join(separator)}${RESET}`
        : ''

    const message = renderMessage(record)
    const messagePart = message ? ` ${message}` : ''

    const header = `${levelTag}${category}${messagePart} ${timestamp}`

    const propKeys = Object.keys(record.properties)
    if (propKeys.length === 0) {
      return header
    }

    // For small property sets (≤ 3 keys, all primitives), use inline format
    if (propKeys.length <= 3 && propKeys.every((k) => isPrimitive(record.properties[k]))) {
      const inline = propKeys
        .map((k) => `${DIM}${k}=${RESET}${renderPrettyValue(record.properties[k])}`)
        .join(' ')
      return `${header} ${inline}`
    }

    // For larger/nested properties, render as a tree
    const treeLines = renderTree(record.properties, '', 0, maxDepth)
    return [header, ...treeLines].join('\n')
  }
}

function isPrimitive(value: unknown): boolean {
  return value === null || value === undefined || typeof value !== 'object'
}

// ---------------------------------------------------------------------------
// Auto Formatter — dev/prod detection
// ---------------------------------------------------------------------------

/**
 * Options for the auto formatter.
 */
export interface AutoFormatterOptions {
  /**
   * Override the environment detection. When not provided, the formatter
   * checks `NODE_ENV` for `"production"`.
   */
  production?: boolean
  /**
   * Options forwarded to {@link getPrettyFormatter} in dev mode.
   */
  pretty?: PrettyFormatterOptions
  /**
   * Options forwarded to {@link getJsonFormatter} in prod mode.
   */
  json?: JsonFormatterOptions
}

/**
 * Creates a formatter that automatically selects pretty output in development
 * and JSON output in production.
 *
 * Detection logic:
 * - If `options.production` is explicitly set, uses that.
 * - Otherwise checks `process.env.NODE_ENV === "production"` (Node/Bun)
 *   or `Deno.env.get("DENO_ENV") === "production"` (Deno).
 * - Defaults to dev (pretty) when detection fails.
 *
 * @example
 * ```ts
 * configure({
 *   sinks: { console: getConsoleSink({ formatter: getAutoFormatter() }) },
 *   loggers: [{ category: 'app', sinks: ['console'], level: 'debug' }],
 * })
 * ```
 */
export function getAutoFormatter(options?: AutoFormatterOptions): TextFormatter {
  const isProd = options?.production ?? detectProduction()
  return isProd
    ? getJsonFormatter(options?.json)
    : getPrettyFormatter(options?.pretty)
}

function detectProduction(): boolean {
  try {
    // Node.js / Bun
    if (typeof process !== 'undefined' && process.env) {
      return process.env.NODE_ENV === 'production'
    }
  } catch {
    // process may throw in restricted environments
  }
  try {
    // Deno
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = (globalThis as any).Deno
    if (d?.env?.get) {
      return d.env.get('DENO_ENV') === 'production'
    }
  } catch {
    // Deno.env.get may throw without --allow-env
  }
  return false
}
