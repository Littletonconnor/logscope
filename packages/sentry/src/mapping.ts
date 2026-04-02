import type { LogLevel, LogRecord } from 'logscope'

/**
 * Sentry severity levels.
 *
 * @see https://develop.sentry.dev/sdk/event-payloads/#optional-attributes
 */
export type SentrySeverity = 'fatal' | 'error' | 'warning' | 'info' | 'debug'

/**
 * A Sentry event payload suitable for the Envelope API.
 *
 * @see https://develop.sentry.dev/sdk/event-payloads/
 */
export interface SentryEvent {
  /** UUID v4 event identifier (without dashes). */
  event_id: string
  /** Unix timestamp in seconds with fractional milliseconds. */
  timestamp: number
  /** Sentry severity level. */
  level: SentrySeverity
  /** Logger name (category joined with `.`). */
  logger: string
  /** Platform identifier. */
  platform: 'javascript'
  /** Formatted log message. */
  message?: { formatted: string }
  /** Extra structured data attached to the event. */
  extra?: Record<string, unknown>
  /** Sentry exception interface — populated when properties contain an Error. */
  exception?: {
    values: SentryExceptionValue[]
  }
  /** Sentry tags (flat string key-value pairs). */
  tags?: Record<string, string>
}

/**
 * A single exception value in Sentry's exception interface.
 */
export interface SentryExceptionValue {
  type: string
  value: string
  stacktrace?: {
    frames: SentryStackFrame[]
  }
}

/**
 * A single frame in a Sentry stacktrace.
 */
export interface SentryStackFrame {
  filename?: string
  function?: string
  lineno?: number
  colno?: number
  in_app?: boolean
}

/**
 * Maps logscope log levels to Sentry severity levels.
 */
const severityMap: Record<LogLevel, SentrySeverity> = {
  trace: 'debug',
  debug: 'debug',
  info: 'info',
  warning: 'warning',
  error: 'error',
  fatal: 'fatal',
}

/**
 * Generates a random UUID v4 hex string (no dashes) for Sentry event IDs.
 */
export function generateEventId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  // Set version 4 bits
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  // Set variant bits
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Renders a logscope message array into a plain string.
 */
function renderMessage(message: readonly unknown[]): string {
  if (message.length === 0) return ''
  return message.map((part) => String(part)).join('')
}

/**
 * Serializes a value for JSON compatibility.
 * Handles Error objects, Dates, BigInts, and other non-JSON-safe types.
 */
function serialize(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'bigint') return String(value)
  if (value instanceof Date) return value.toISOString()

  if (value instanceof Error) {
    const obj: Record<string, unknown> = {
      name: value.name,
      message: value.message,
    }
    if (value.stack) obj.stack = value.stack
    if (value.cause !== undefined) obj.cause = serialize(value.cause)
    return obj
  }

  if (Array.isArray(value)) return value.map(serialize)

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = serialize(v)
    }
    return result
  }

  return value
}

/**
 * Parses a V8-style stack trace string into Sentry stack frames.
 *
 * Frames are returned in reverse order (oldest first) as Sentry expects.
 */
export function parseStackFrames(stack: string): SentryStackFrame[] {
  const frames: SentryStackFrame[] = []
  const lines = stack.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('at ')) continue

    const frame: SentryStackFrame = {}
    const rest = trimmed.slice(3) // Remove "at "

    // Match "at functionName (file:line:col)" or "at file:line:col"
    const parenMatch = rest.match(/^(.+?)\s+\((.+):(\d+):(\d+)\)$/)
    if (parenMatch) {
      frame.function = parenMatch[1]
      frame.filename = parenMatch[2]
      frame.lineno = parseInt(parenMatch[3], 10)
      frame.colno = parseInt(parenMatch[4], 10)
    } else {
      const directMatch = rest.match(/^(.+):(\d+):(\d+)$/)
      if (directMatch) {
        frame.filename = directMatch[1]
        frame.lineno = parseInt(directMatch[2], 10)
        frame.colno = parseInt(directMatch[3], 10)
      } else {
        frame.function = rest
      }
    }

    // Mark node_modules frames as not in_app
    frame.in_app = !frame.filename?.includes('node_modules')

    frames.push(frame)
  }

  // Sentry expects oldest frame first
  return frames.reverse()
}

/**
 * Extracts an Error from a LogRecord's properties, if present.
 *
 * Looks for common property names: `error`, `err`, `exception`.
 */
function extractError(properties: Record<string, unknown>): Error | undefined {
  for (const key of ['error', 'err', 'exception']) {
    if (properties[key] instanceof Error) {
      return properties[key] as Error
    }
  }
  return undefined
}

/**
 * Builds Sentry exception values from an Error, including its cause chain.
 */
function toExceptionValues(error: Error): SentryExceptionValue[] {
  const values: SentryExceptionValue[] = []
  let current: unknown = error

  while (current instanceof Error) {
    const value: SentryExceptionValue = {
      type: current.name,
      value: current.message,
    }

    if (current.stack) {
      const frames = parseStackFrames(current.stack)
      if (frames.length > 0) {
        value.stacktrace = { frames }
      }
    }

    values.push(value)
    current = current.cause
  }

  // Sentry expects outermost exception last
  return values.reverse()
}

/**
 * Builds the `extra` field, excluding any Error values that were
 * already extracted into the `exception` interface.
 */
function buildExtra(properties: Record<string, unknown>): Record<string, unknown> | undefined {
  const extra: Record<string, unknown> = {}
  let hasKeys = false

  for (const [key, value] of Object.entries(properties)) {
    if (value instanceof Error) continue
    extra[key] = serialize(value)
    hasKeys = true
  }

  return hasKeys ? extra : undefined
}

/**
 * Converts a logscope {@link LogRecord} into a {@link SentryEvent}.
 *
 * - Error/fatal records with an `error`/`err`/`exception` property
 *   produce a Sentry event with a full exception chain and stack frames.
 * - All other records produce a simple message event.
 * - Structured properties are attached as `extra` data.
 *
 * @example
 * ```typescript
 * const event = toSentryEvent(record)
 * // → { event_id: "...", level: "error", exception: { ... }, ... }
 * ```
 */
export function toSentryEvent(record: LogRecord): SentryEvent {
  const message = renderMessage(record.message) || record.rawMessage || undefined

  const event: SentryEvent = {
    event_id: generateEventId(),
    timestamp: record.timestamp / 1000,
    level: severityMap[record.level],
    logger: record.category.join('.'),
    platform: 'javascript',
  }

  if (message) {
    event.message = { formatted: message }
  }

  // Extract Error objects for the exception interface
  const error = extractError(record.properties)
  if (error) {
    event.exception = { values: toExceptionValues(error) }
  }

  const extra = buildExtra(record.properties)
  if (extra) {
    event.extra = extra
  }

  return event
}

/**
 * Converts a batch of logscope LogRecords into an array of Sentry events.
 */
export function toSentryEvents(batch: readonly LogRecord[]): SentryEvent[] {
  return batch.map(toSentryEvent)
}

/**
 * Parsed components of a Sentry DSN.
 */
export interface ParsedDsn {
  /** The public key (before the `@`). */
  publicKey: string
  /** The full host with protocol (e.g., `https://o123.ingest.sentry.io`). */
  host: string
  /** The project ID (last path segment). */
  projectId: string
}

/**
 * Parses a Sentry DSN string into its components.
 *
 * DSN format: `https://<public_key>@<host>/<project_id>`
 *
 * @throws {Error} If the DSN is malformed.
 */
export function parseDsn(dsn: string): ParsedDsn {
  let url: URL
  try {
    url = new URL(dsn)
  } catch {
    throw new Error(`Invalid Sentry DSN: ${dsn}`)
  }

  const publicKey = url.username
  if (!publicKey) {
    throw new Error(`Invalid Sentry DSN: missing public key in ${dsn}`)
  }

  const pathParts = url.pathname.split('/').filter(Boolean)
  const projectId = pathParts.pop()
  if (!projectId) {
    throw new Error(`Invalid Sentry DSN: missing project ID in ${dsn}`)
  }

  const basePath = pathParts.length > 0 ? `/${pathParts.join('/')}` : ''
  const host = `${url.protocol}//${url.host}${basePath}`

  return { publicKey, host, projectId }
}

/**
 * Builds the Sentry envelope endpoint URL from parsed DSN components.
 */
export function buildEnvelopeUrl(dsn: ParsedDsn): string {
  return `${dsn.host}/api/${dsn.projectId}/envelope/`
}

/**
 * Serializes a batch of Sentry events into a Sentry envelope body.
 *
 * Each event becomes a separate item in the envelope:
 * ```
 * {"event_id":"...","sent_at":"..."}\n
 * {"type":"event","content_type":"application/json"}\n
 * {...event JSON...}\n
 * ```
 *
 * @see https://develop.sentry.dev/sdk/envelopes/
 */
export function toEnvelopeBody(events: readonly SentryEvent[], dsn: string): string {
  const parts: string[] = []

  for (const event of events) {
    const header = JSON.stringify({
      event_id: event.event_id,
      dsn,
      sent_at: new Date().toISOString(),
    })
    const itemHeader = JSON.stringify({
      type: 'event',
      content_type: 'application/json',
    })
    const payload = JSON.stringify(event)

    parts.push(`${header}\n${itemHeader}\n${payload}`)
  }

  return parts.join('\n')
}
