import type { LogRecord, DisposableSink, PipelineOptions } from 'logscope'
import { createPipeline } from 'logscope'
import { toExportLogsServiceRequest } from './mapping.ts'
import type { OtlpResource } from './mapping.ts'

/**
 * Options for {@link createOtlpExporter}.
 */
export interface OtlpExporterOptions {
  /**
   * The OTLP HTTP/JSON endpoint for logs.
   * @default "http://localhost:4318/v1/logs"
   */
  endpoint?: string
  /**
   * HTTP headers to include in every export request.
   * Use this for authentication tokens, API keys, etc.
   *
   * @example
   * ```typescript
   * headers: { Authorization: 'Bearer my-token' }
   * ```
   */
  headers?: Record<string, string>
  /**
   * Resource attributes that identify the source of these logs.
   * At minimum, set `service.name` to identify your application.
   *
   * @example
   * ```typescript
   * resource: {
   *   'service.name': 'my-api',
   *   'service.version': '1.2.0',
   *   'deployment.environment': 'production',
   * }
   * ```
   */
  resource?: OtlpResource
  /**
   * Batching configuration. Records are buffered and sent in batches
   * to reduce network overhead.
   */
  batch?: {
    /** Max records per batch before auto-flush. Default: `100`. */
    size?: number
    /** Max ms to wait before flushing an incomplete batch. Default: `5000`. */
    intervalMs?: number
  }
  /** Max records to buffer before dropping oldest. Default: `10000`. */
  maxBufferSize?: number
  /** Max attempts per batch (including the initial attempt). Default: `3`. */
  maxAttempts?: number
  /** Backoff strategy for retries. Default: `"exponential"`. */
  backoff?: PipelineOptions['backoff']
  /** Base delay in ms for backoff calculation. Default: `1000`. */
  baseDelayMs?: number
  /**
   * Called when a batch is permanently dropped after all retries fail.
   */
  onDropped?: (batch: readonly LogRecord[], error: unknown) => void
  /**
   * Custom fetch implementation. Defaults to the global `fetch`.
   * Useful for testing or environments where global fetch is unavailable.
   */
  fetch?: typeof globalThis.fetch
  /**
   * Request timeout in milliseconds. Default: `10000` (10 seconds).
   */
  timeoutMs?: number
}

/**
 * Creates an OTLP HTTP/JSON log exporter that sends logscope records to
 * any OpenTelemetry-compatible collector or backend.
 *
 * Under the hood, this wraps {@link createPipeline} from logscope core,
 * giving you automatic batching, retry with backoff, and buffer overflow
 * protection. The returned sink is a {@link DisposableSink} — call
 * `flush()` or use `await using` for graceful shutdown.
 *
 * @example
 * ```typescript
 * import { configure } from 'logscope'
 * import { createOtlpExporter } from '@logscope/otlp'
 *
 * await configure({
 *   sinks: {
 *     otlp: createOtlpExporter({
 *       endpoint: 'http://localhost:4318/v1/logs',
 *       resource: { 'service.name': 'my-api' },
 *       headers: { Authorization: 'Bearer token' },
 *     }),
 *   },
 *   loggers: [{ category: 'my-app', sinks: ['otlp'], level: 'info' }],
 * })
 * ```
 */
export function createOtlpExporter(options: OtlpExporterOptions = {}): DisposableSink {
  const {
    endpoint = 'http://localhost:4318/v1/logs',
    headers: customHeaders = {},
    resource = {},
    batch,
    maxBufferSize,
    maxAttempts,
    backoff,
    baseDelayMs,
    onDropped,
    fetch: fetchImpl = globalThis.fetch,
    timeoutMs = 10_000,
  } = options

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...customHeaders,
  }

  async function sendBatch(records: readonly LogRecord[]): Promise<void> {
    const payload = toExportLogsServiceRequest(records, resource)
    const body = JSON.stringify(payload)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      })

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(
          `OTLP export failed: HTTP ${response.status} ${response.statusText}${text ? ` — ${text}` : ''}`,
        )
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  return createPipeline({
    sink: sendBatch,
    batch,
    maxBufferSize,
    maxAttempts,
    backoff,
    baseDelayMs,
    onDropped,
  })
}
