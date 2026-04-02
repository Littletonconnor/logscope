import type { LogLevel, LogRecord } from 'logscope'

// --- OTLP Protobuf-compatible types (JSON encoding) ---

/**
 * OTLP severity numbers as defined in the OpenTelemetry Log Data Model.
 * @see https://opentelemetry.io/docs/specs/otel/logs/data-model/#severity-fields
 */
export const SeverityNumber = {
  TRACE: 1,
  DEBUG: 5,
  INFO: 9,
  WARN: 13,
  ERROR: 17,
  FATAL: 21,
} as const

/**
 * Maps logscope LogLevel to OTLP severity number and text.
 */
const levelMapping: Record<LogLevel, { severityNumber: number; severityText: string }> = {
  trace: { severityNumber: SeverityNumber.TRACE, severityText: 'TRACE' },
  debug: { severityNumber: SeverityNumber.DEBUG, severityText: 'DEBUG' },
  info: { severityNumber: SeverityNumber.INFO, severityText: 'INFO' },
  warning: { severityNumber: SeverityNumber.WARN, severityText: 'WARN' },
  error: { severityNumber: SeverityNumber.ERROR, severityText: 'ERROR' },
  fatal: { severityNumber: SeverityNumber.FATAL, severityText: 'FATAL' },
}

/**
 * An OTLP AnyValue — the recursive value type used in OTLP attributes and body.
 *
 * In OTLP JSON encoding, values are objects with a single key indicating the type:
 * `{ stringValue: "..." }`, `{ intValue: "123" }`, `{ boolValue: true }`, etc.
 */
export type OtlpAnyValue =
  | { stringValue: string }
  | { intValue: string }
  | { doubleValue: number }
  | { boolValue: boolean }
  | { arrayValue: { values: OtlpAnyValue[] } }
  | { kvlistValue: { values: OtlpKeyValue[] } }

export interface OtlpKeyValue {
  key: string
  value: OtlpAnyValue
}

/**
 * Converts a JavaScript value to an OTLP AnyValue.
 *
 * Handles primitives, arrays, plain objects, Errors, Dates, and falls back
 * to string conversion for anything else (functions, symbols, etc.).
 */
export function toAnyValue(value: unknown): OtlpAnyValue {
  if (value === null || value === undefined) {
    return { stringValue: String(value) }
  }

  switch (typeof value) {
    case 'string':
      return { stringValue: value }
    case 'boolean':
      return { boolValue: value }
    case 'number':
      // OTLP distinguishes int vs double. Use intValue for safe integers.
      if (Number.isInteger(value) && Number.isSafeInteger(value)) {
        return { intValue: String(value) }
      }
      return { doubleValue: value }
    case 'bigint':
      return { intValue: String(value) }
    default:
      break
  }

  if (value instanceof Date) {
    return { stringValue: value.toISOString() }
  }

  if (value instanceof Error) {
    return {
      kvlistValue: {
        values: [
          { key: 'name', value: { stringValue: value.name } },
          { key: 'message', value: { stringValue: value.message } },
          ...(value.stack ? [{ key: 'stack', value: { stringValue: value.stack } }] : []),
          ...(value.cause !== undefined
            ? [{ key: 'cause', value: toAnyValue(value.cause) }]
            : []),
        ],
      },
    }
  }

  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toAnyValue) } }
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    return {
      kvlistValue: {
        values: entries.map(([key, val]) => ({ key, value: toAnyValue(val) })),
      },
    }
  }

  // Functions, symbols, etc.
  return { stringValue: String(value) }
}

/**
 * Converts a record's properties to an array of OTLP KeyValue attributes.
 */
export function toAttributes(properties: Record<string, unknown>): OtlpKeyValue[] {
  return Object.entries(properties).map(([key, value]) => ({
    key,
    value: toAnyValue(value),
  }))
}

/**
 * Renders a logscope message array into a plain string body.
 * Interleaved format: strings at even indices, values at odd indices.
 */
function renderMessageBody(message: readonly unknown[], rawMessage: string): string {
  if (message.length === 0) return rawMessage
  return message.map((part, i) => (i % 2 === 0 ? String(part) : String(part))).join('')
}

/**
 * OTLP LogRecord in the JSON encoding format.
 * @see https://opentelemetry.io/docs/specs/otlp/#json-protobuf-encoding
 */
export interface OtlpLogRecord {
  timeUnixNano: string
  severityNumber: number
  severityText: string
  body?: OtlpAnyValue
  attributes: OtlpKeyValue[]
}

/**
 * The full OTLP ExportLogsServiceRequest payload structure.
 */
export interface ExportLogsServiceRequest {
  resourceLogs: Array<{
    resource: { attributes: OtlpKeyValue[] }
    scopeLogs: Array<{
      scope: { name: string; version?: string }
      logRecords: OtlpLogRecord[]
    }>
  }>
}

/**
 * Resource attributes that identify the source of logs.
 */
export interface OtlpResource {
  /** The logical name of the service (maps to `service.name`). */
  'service.name'?: string
  /** Additional resource attributes. */
  [key: string]: unknown
}

/**
 * Converts a batch of logscope LogRecords into an OTLP ExportLogsServiceRequest.
 *
 * Groups records by their category (which becomes the instrumentation scope name).
 * This means records from `createLogger("my-app")` and `createLogger(["my-app", "db"])`
 * get their own scope entries, keeping the OTLP payload well-organized.
 */
export function toExportLogsServiceRequest(
  batch: readonly LogRecord[],
  resource: OtlpResource = {},
): ExportLogsServiceRequest {
  // Build resource attributes
  const resourceAttributes = toAttributes(resource)

  // Group records by scope (category joined by ".")
  const scopeMap = new Map<string, OtlpLogRecord[]>()

  for (const record of batch) {
    const scopeName = record.category.join('.')
    const severity = levelMapping[record.level]
    const body = renderMessageBody(record.message, record.rawMessage)

    // OTLP expects nanoseconds as a string (milliseconds * 1e6)
    const timeUnixNano = String(record.timestamp * 1_000_000)

    // Category is already captured as the scope name, so we put properties
    // plus the raw category array as attributes
    const attributes: OtlpKeyValue[] = [
      { key: 'log.category', value: { arrayValue: { values: record.category.map((c) => ({ stringValue: c })) } } },
      ...toAttributes(record.properties),
    ]

    const otlpRecord: OtlpLogRecord = {
      timeUnixNano,
      severityNumber: severity.severityNumber,
      severityText: severity.severityText,
      ...(body ? { body: { stringValue: body } } : {}),
      attributes,
    }

    let records = scopeMap.get(scopeName)
    if (!records) {
      records = []
      scopeMap.set(scopeName, records)
    }
    records.push(otlpRecord)
  }

  // Build scopeLogs from the grouped map
  const scopeLogs = Array.from(scopeMap.entries()).map(([name, logRecords]) => ({
    scope: { name },
    logRecords,
  }))

  return {
    resourceLogs: [
      {
        resource: { attributes: resourceAttributes },
        scopeLogs,
      },
    ],
  }
}
