import type { LogRecord, DisposableSink, PipelineOptions } from 'logscope'
import { createPipeline } from 'logscope'
import { toAxiomEvents } from './mapping.ts'

/**
 * Options for {@link createAxiomSink}.
 */
export interface AxiomSinkOptions {
  /**
   * The Axiom dataset to ingest into.
   *
   * @example "my-app-logs"
   */
  dataset: string
  /**
   * Axiom API token with ingest permissions.
   *
   * @example "xaat-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
   */
  token: string
  /**
   * The Axiom API base URL.
   * @default "https://api.axiom.co"
   */
  url?: string
  /**
   * Additional HTTP headers to include in every ingest request.
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
 * Creates an Axiom log sink that sends logscope records to
 * an Axiom dataset via the Ingest API.
 *
 * Under the hood, this wraps {@link createPipeline} from logscope core,
 * giving you automatic batching, retry with backoff, and buffer overflow
 * protection. The returned sink is a {@link DisposableSink} — call
 * `flush()` or use `await using` for graceful shutdown.
 *
 * @example
 * ```typescript
 * import { configure } from 'logscope'
 * import { createAxiomSink } from '@logscope/axiom'
 *
 * await configure({
 *   sinks: {
 *     axiom: createAxiomSink({
 *       dataset: 'my-app-logs',
 *       token: process.env.AXIOM_TOKEN!,
 *     }),
 *   },
 *   loggers: [{ category: 'my-app', sinks: ['axiom'], level: 'info' }],
 * })
 * ```
 */
export function createAxiomSink(options: AxiomSinkOptions): DisposableSink {
  const {
    dataset,
    token,
    url = 'https://api.axiom.co',
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

  const endpoint = `${url}/v1/datasets/${encodeURIComponent(dataset)}/ingest`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    ...customHeaders,
  }

  async function sendBatch(records: readonly LogRecord[]): Promise<void> {
    const events = toAxiomEvents(records)
    const body = JSON.stringify(events)

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
          `Axiom ingest failed: HTTP ${response.status} ${response.statusText}${text ? ` — ${text}` : ''}`,
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
