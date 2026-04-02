import type { LogRecord, DisposableSink, PipelineOptions } from 'logscope'
import { createPipeline } from 'logscope'
import { toSentryEvents, toEnvelopeBody, parseDsn, buildEnvelopeUrl } from './mapping.ts'

/**
 * Options for {@link createSentrySink}.
 */
export interface SentrySinkOptions {
  /**
   * The Sentry DSN (Data Source Name).
   *
   * Format: `https://<public_key>@<host>/<project_id>`
   *
   * @example "https://examplePublicKey@o0.ingest.sentry.io/0"
   */
  dsn: string
  /**
   * The environment name (e.g., "production", "staging").
   * Sent as a tag on every event.
   */
  environment?: string
  /**
   * The release identifier (e.g., "1.0.0", "abc123").
   * Sent as a tag on every event.
   */
  release?: string
  /**
   * Additional HTTP headers to include in every request.
   */
  headers?: Record<string, string>
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
 * Creates a Sentry log sink that sends logscope records to Sentry
 * via the Envelope API.
 *
 * Error and fatal records that include an `error`, `err`, or `exception`
 * property with an `Error` value will produce Sentry events with full
 * exception chains and parsed stack frames. All other records are sent
 * as message events with structured `extra` data.
 *
 * Under the hood, this wraps {@link createPipeline} from logscope core,
 * giving you automatic batching, retry with backoff, and buffer overflow
 * protection. The returned sink is a {@link DisposableSink} — call
 * `flush()` or use `await using` for graceful shutdown.
 *
 * @example
 * ```typescript
 * import { configure } from 'logscope'
 * import { createSentrySink } from '@logscope/sentry'
 *
 * await configure({
 *   sinks: {
 *     sentry: createSentrySink({
 *       dsn: process.env.SENTRY_DSN!,
 *       environment: 'production',
 *       release: '1.0.0',
 *     }),
 *   },
 *   loggers: [{ category: 'my-app', sinks: ['sentry'], level: 'error' }],
 * })
 * ```
 */
export function createSentrySink(options: SentrySinkOptions): DisposableSink {
  const {
    dsn,
    environment,
    release,
    headers: customHeaders = {},
    batch,
    maxBufferSize,
    maxAttempts,
    backoff,
    baseDelayMs,
    onDropped,
    fetch: fetchImpl = globalThis.fetch,
    timeoutMs = 10_000,
  } = options

  const parsed = parseDsn(dsn)
  const endpoint = buildEnvelopeUrl(parsed)

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-sentry-envelope',
    'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${parsed.publicKey}, sentry_client=logscope/0.0.1`,
    ...customHeaders,
  }

  async function sendBatch(records: readonly LogRecord[]): Promise<void> {
    const events = toSentryEvents(records)

    // Attach environment/release tags to each event
    if (environment || release) {
      for (const event of events) {
        if (environment || release) {
          event.tags = {
            ...(event.tags ?? {}),
            ...(environment ? { environment } : {}),
            ...(release ? { release } : {}),
          }
        }
      }
    }

    const body = toEnvelopeBody(events, dsn)

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
          `Sentry envelope send failed: HTTP ${response.status} ${response.statusText}${text ? ` — ${text}` : ''}`,
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
