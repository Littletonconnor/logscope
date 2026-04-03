import type { LogRecord } from './record.ts'
import type { DisposableSink } from './sink.ts'
import type { Sink } from './sink.ts'

/**
 * Backoff strategy for retrying failed batch flushes.
 *
 * - `"exponential"` — doubles the delay each attempt (default)
 * - `"linear"` — increases by a fixed step each attempt
 * - `"fixed"` — same delay every attempt
 */
export type BackoffStrategy = 'exponential' | 'linear' | 'fixed'

/**
 * Options for {@link createPipeline}.
 */
export interface PipelineOptions {
  /**
   * Async function that processes a batch of log records.
   * This is where you send records to an external service, write to a file, etc.
   */
  sink: (batch: readonly LogRecord[]) => Promise<void>
  /**
   * Batching configuration.
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
  backoff?: BackoffStrategy
  /** Base delay in ms for backoff calculation. Default: `1000`. */
  baseDelayMs?: number
  /** Called when a batch is permanently dropped after all retries fail. */
  onDropped?: (batch: readonly LogRecord[], error: unknown) => void
}

function getDelay(strategy: BackoffStrategy, attempt: number, baseMs: number): number {
  switch (strategy) {
    case 'exponential':
      return baseMs * 2 ** attempt
    case 'linear':
      return baseMs * (attempt + 1)
    case 'fixed':
      return baseMs
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Creates a batching, retrying pipeline that wraps an async batch sink
 * and returns a synchronous {@link Sink} compatible with `configure()`.
 *
 * Records are buffered until either `batch.size` is reached or
 * `batch.intervalMs` elapses, then sent to the async sink. On failure,
 * the batch is retried with the configured backoff strategy up to
 * `maxAttempts` times. If all retries fail, `onDropped` is called.
 *
 * If the buffer exceeds `maxBufferSize`, the oldest records are dropped
 * and `onDropped` is called with the dropped records.
 *
 * Call `flush()` or use `await using` for graceful shutdown.
 */
export function createPipeline(options: PipelineOptions): DisposableSink {
  const batchSize = options.batch?.size ?? 100
  const intervalMs = options.batch?.intervalMs ?? 5000
  const maxBufferSize = options.maxBufferSize ?? 10000
  const maxAttempts = options.maxAttempts ?? 3
  const backoff = options.backoff ?? 'exponential'
  const baseDelayMs = options.baseDelayMs ?? 1000
  const onDropped = options.onDropped
  const batchSink = options.sink

  const buffer: LogRecord[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: Promise<void> = Promise.resolve()
  let disposed = false

  function scheduleDrain() {
    if (timer !== null || disposed) return
    timer = setTimeout(() => {
      timer = null
      drainBuffer()
    }, intervalMs)
  }

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  async function sendBatch(batch: readonly LogRecord[]): Promise<void> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await batchSink(batch)
        return
      } catch (error: unknown) {
        if (attempt === maxAttempts - 1) {
          onDropped?.(batch, error)
          return
        }
        await sleep(getDelay(backoff, attempt, baseDelayMs))
      }
    }
  }

  function drainBuffer() {
    if (buffer.length === 0) return

    const batch = buffer.splice(0, batchSize)
    pending = pending.then(() => sendBatch(batch))

    if (buffer.length >= batchSize) {
      drainBuffer()
    } else if (buffer.length > 0) {
      scheduleDrain()
    }
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

    while (buffer.length > 0) {
      const batch = buffer.splice(0, batchSize)
      pending = pending.then(() => sendBatch(batch))
    }

    await pending
  }

  disposableSink[Symbol.asyncDispose] = () => disposableSink.flush()

  return disposableSink
}
