import type { LogRecord } from './record.ts'
import type { DisposableSink, Sink } from './sink.ts'

/**
 * Serializer function that converts a batch of log records into a sendable body.
 * Defaults to JSON array serialization.
 */
export type RecordSerializer = (batch: readonly LogRecord[]) => string | Blob | ArrayBuffer

/**
 * Options for {@link createBrowserDrain}.
 */
export interface BrowserDrainOptions {
  /**
   * The endpoint URL to send log batches to.
   */
  endpoint: string
  /**
   * HTTP method for fetch requests. Default: `"POST"`.
   */
  method?: string
  /**
   * Custom headers to include in fetch requests.
   * Not used for `sendBeacon` (which doesn't support custom headers).
   */
  headers?: Record<string, string>
  /**
   * Serializes a batch of log records into a request body.
   * Default: `JSON.stringify(batch)` with `Content-Type: application/json`.
   */
  serializer?: RecordSerializer
  /**
   * Batching configuration.
   */
  batch?: {
    /** Max records per batch before auto-flush. Default: `50`. */
    size?: number
    /** Max ms to wait before flushing an incomplete batch. Default: `5000`. */
    intervalMs?: number
  }
  /** Max records to buffer before dropping oldest. Default: `1000`. */
  maxBufferSize?: number
  /**
   * Whether to automatically flush when the page visibility changes to "hidden".
   * Default: `true`.
   */
  flushOnVisibilityChange?: boolean
  /**
   * Whether to use `navigator.sendBeacon` as a last-resort transport during
   * page unload. Falls back to `fetch` with `keepalive` if `sendBeacon` is
   * unavailable. Default: `true`.
   */
  useBeaconOnUnload?: boolean
  /** Called when a batch is permanently dropped (e.g., send failed). */
  onDropped?: (batch: readonly LogRecord[], error: unknown) => void
}

/**
 * Default serializer — JSON array of log records.
 */
function defaultSerializer(batch: readonly LogRecord[]): string {
  return JSON.stringify(batch)
}

/**
 * Sends a batch using `fetch` with `keepalive: true`.
 *
 * `keepalive` tells the browser to complete the request even if the page
 * is being unloaded, similar to `sendBeacon` but with full `fetch` control
 * (custom headers, method, etc.). The total body size across all keepalive
 * requests is limited to ~64KB by most browsers.
 */
async function sendWithKeepaliveFetch(
  endpoint: string,
  body: string | Blob | ArrayBuffer,
  method: string,
  headers: Record<string, string>,
): Promise<void> {
  const response = await fetch(endpoint, {
    method,
    headers,
    body,
    keepalive: true,
  })
  if (!response.ok) {
    throw new Error(`Browser drain: HTTP ${response.status} ${response.statusText}`)
  }
}

/**
 * Sends a batch using `navigator.sendBeacon`.
 *
 * `sendBeacon` is a fire-and-forget API guaranteed to deliver during page
 * unload. It does not support custom headers or methods — always POST.
 * Body size is typically limited to ~64KB.
 *
 * Returns `true` if the browser accepted the beacon, `false` if it was
 * rejected (e.g., body too large or queue full).
 */
function sendWithBeacon(endpoint: string, body: string | Blob | ArrayBuffer): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') {
    return false
  }
  return navigator.sendBeacon(endpoint, body as BodyInit)
}

/**
 * Creates a browser-optimized sink that batches log records and sends them
 * to a remote endpoint using `fetch` with `keepalive: true`.
 *
 * Handles the three hardest browser logging problems:
 *
 * 1. **Page unload** — Uses `navigator.sendBeacon` (or `keepalive` fetch)
 *    during `pagehide`/`beforeunload` to ensure buffered logs are delivered
 *    even when the user closes the tab or navigates away.
 *
 * 2. **Visibility change** — Automatically flushes the buffer when the page
 *    becomes hidden (user switches tabs), since there's no guarantee the
 *    page will become visible again.
 *
 * 3. **Batching** — Accumulates records and sends them in batches to reduce
 *    network overhead. Flushes when the batch reaches `batch.size` or after
 *    `batch.intervalMs` elapses.
 *
 * Returns a {@link DisposableSink} — call `flush()` for graceful shutdown.
 *
 * @example
 * ```typescript
 * import { configure, createBrowserDrain } from 'logscope'
 *
 * await configure({
 *   sinks: {
 *     remote: createBrowserDrain({
 *       endpoint: '/api/logs',
 *       headers: { Authorization: 'Bearer token' },
 *       batch: { size: 25, intervalMs: 10_000 },
 *     }),
 *   },
 *   loggers: [{ category: 'my-app', sinks: ['remote'], level: 'info' }],
 * })
 * ```
 */
export function createBrowserDrain(options: BrowserDrainOptions): DisposableSink {
  const {
    endpoint,
    method = 'POST',
    headers: customHeaders = {},
    serializer = defaultSerializer,
    maxBufferSize = 1000,
    flushOnVisibilityChange = true,
    useBeaconOnUnload = true,
    onDropped,
  } = options
  const batchSize = options.batch?.size ?? 50
  const intervalMs = options.batch?.intervalMs ?? 5000

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...customHeaders,
  }

  const buffer: LogRecord[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: Promise<void> = Promise.resolve()
  let disposed = false

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function scheduleDrain() {
    if (timer !== null || disposed) return
    timer = setTimeout(() => {
      timer = null
      drainBuffer()
    }, intervalMs)
  }

  function drainBuffer() {
    if (buffer.length === 0) return

    const batch = buffer.splice(0, batchSize)
    pending = pending.then(async () => {
      try {
        const body = serializer(batch)
        await sendWithKeepaliveFetch(endpoint, body, method, headers)
      } catch (error: unknown) {
        onDropped?.(batch, error)
      }
    })

    if (buffer.length >= batchSize) {
      drainBuffer()
    } else if (buffer.length > 0) {
      scheduleDrain()
    }
  }

  /**
   * Synchronously sends all buffered records via `sendBeacon` (preferred)
   * or `keepalive` fetch. Used during page unload when async operations
   * are unreliable.
   */
  function flushSync() {
    if (buffer.length === 0) return

    const batch = buffer.splice(0)
    const body = serializer(batch)

    if (useBeaconOnUnload) {
      const accepted = sendWithBeacon(endpoint, body)
      if (!accepted) {
        try {
          fetch(endpoint, { method, headers, body, keepalive: true }).catch(() => {})
        } catch {
          onDropped?.(batch, new Error('Both sendBeacon and keepalive fetch failed during unload'))
        }
      }
    } else {
      try {
        fetch(endpoint, { method, headers, body, keepalive: true }).catch(() => {})
      } catch {
        onDropped?.(batch, new Error('keepalive fetch failed during unload'))
      }
    }
  }

  function handleVisibilityChange() {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      clearTimer()
      flushSync()
    }
  }

  function handlePageHide() {
    clearTimer()
    flushSync()
  }

  if (flushOnVisibilityChange && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange)
  }

  if (useBeaconOnUnload && typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('pagehide', handlePageHide)
  }

  const sink: Sink = (record: LogRecord) => {
    if (disposed) return

    buffer.push(record)

    if (buffer.length > maxBufferSize) {
      const dropped = buffer.splice(0, buffer.length - maxBufferSize)
      onDropped?.(dropped, new Error('Buffer overflow: maxBufferSize exceeded'))
    }

    if (buffer.length >= batchSize) {
      clearTimer()
      drainBuffer()
    } else {
      scheduleDrain()
    }
  }

  const disposableSink = sink as DisposableSink

  disposableSink.flush = async () => {
    clearTimer()
    disposed = true

    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
    if (typeof globalThis.removeEventListener === 'function') {
      globalThis.removeEventListener('pagehide', handlePageHide)
    }

    while (buffer.length > 0) {
      const batch = buffer.splice(0, batchSize)
      pending = pending.then(async () => {
        try {
          const body = serializer(batch)
          await sendWithKeepaliveFetch(endpoint, body, method, headers)
        } catch (error: unknown) {
          onDropped?.(batch, error)
        }
      })
    }

    await pending
  }

  disposableSink[Symbol.asyncDispose] = () => disposableSink.flush()

  return disposableSink
}
