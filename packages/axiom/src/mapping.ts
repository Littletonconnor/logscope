import type { LogLevel, LogRecord } from 'logscope'

/**
 * An Axiom event — a flat JSON object sent to the Axiom Ingest API.
 *
 * Axiom expects an array of these objects. The `_time` field is the
 * canonical timestamp; all other fields are user-defined.
 */
export interface AxiomEvent {
  /** ISO 8601 timestamp. Axiom uses this as the canonical event time. */
  _time: string
  /** Log severity level (e.g., "info", "error"). */
  level: string
  /** Logger category joined with `.` (e.g., "my-app.db"). */
  logger: string
  /** The rendered log message, if present. */
  message?: string
  /** All structured properties from the log record. */
  [key: string]: unknown
}

/**
 * Maps logscope LogLevel to Axiom-friendly uppercase level strings.
 */
const levelText: Record<LogLevel, string> = {
  trace: 'TRACE',
  debug: 'DEBUG',
  info: 'INFO',
  warning: 'WARN',
  error: 'ERROR',
  fatal: 'FATAL',
}

/**
 * Renders a logscope message array into a plain string.
 * Interleaved format: strings at even indices, values at odd indices.
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
 * Serializes all properties in a record for safe JSON encoding.
 */
function serializeProperties(properties: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(properties)) {
    result[key] = serialize(value)
  }
  return result
}

/**
 * Converts a logscope LogRecord into an Axiom event object.
 *
 * Properties are spread at the top level of the event so they're
 * directly queryable in Axiom's APL (Axiom Processing Language).
 * The `level`, `logger`, and `_time` fields are always present.
 */
export function toAxiomEvent(record: LogRecord): AxiomEvent {
  const message = renderMessage(record.message) || record.rawMessage || undefined

  return {
    _time: new Date(record.timestamp).toISOString(),
    level: levelText[record.level],
    logger: record.category.join('.'),
    ...(message ? { message } : {}),
    ...serializeProperties(record.properties),
  }
}

/**
 * Converts a batch of logscope LogRecords into an array of Axiom events,
 * ready to be JSON-serialized and sent to the Axiom Ingest API.
 */
export function toAxiomEvents(batch: readonly LogRecord[]): AxiomEvent[] {
  return batch.map(toAxiomEvent)
}
