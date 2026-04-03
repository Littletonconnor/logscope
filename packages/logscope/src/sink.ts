import type { LogRecord } from './record.ts'
import type { LogLevel } from './level.ts'
import type { Filter, FilterLike } from './filter.ts'
import type { TextFormatter } from './formatter.ts'
import { toFilter } from './filter.ts'

/**
 * A sink receives log records and outputs them somewhere.
 * The simplest possible contract — just a function.
 */
export type Sink = (record: LogRecord) => void

/**
 * A sink that supports async disposal and flushing of pending writes.
 * Assignable to `Sink` everywhere, but exposes extra lifecycle methods.
 */
export type DisposableSink = Sink & {
  /** Waits for all pending async writes to complete. */
  flush(): Promise<void>
  /** Async disposal — flushes pending writes. Enables `await using`. */
  [Symbol.asyncDispose](): Promise<void>
}

/**
 * Options for {@link getConsoleSink}.
 */
export interface ConsoleSinkOptions {
  /**
   * A formatter that converts a LogRecord into a string for console output.
   * If not provided, a simple default format is used.
   */
  formatter?: (record: LogRecord) => string
}

/**
 * Options for {@link getNonBlockingConsoleSink}.
 */
export interface NonBlockingConsoleSinkOptions {
  /**
   * A formatter that converts a LogRecord into a string for console output.
   * If not provided, a simple default format is used.
   */
  formatter?: (record: LogRecord) => string
}

/**
 * Options for {@link getStreamSink}.
 */
export interface StreamSinkOptions {
  /**
   * A formatter that converts a LogRecord into a string before writing.
   * Defaults to the text formatter from `getTextFormatter()`.
   */
  formatter?: TextFormatter
}

const levelToConsoleMethod: Record<LogLevel, 'debug' | 'info' | 'warn' | 'error'> = {
  trace: 'debug',
  debug: 'debug',
  info: 'info',
  warning: 'warn',
  error: 'error',
  fatal: 'error',
}

function defaultFormatter(record: LogRecord): string {
  const timestamp = new Date(record.timestamp).toISOString()
  const level = record.level.toUpperCase()
  const category = record.category.join(' · ')

  const message = record.message
    .map((part) => (typeof part === 'string' ? part : String(part)))
    .join('')

  const propKeys = Object.keys(record.properties)
  const props = propKeys.length > 0 ? ` ${JSON.stringify(record.properties)}` : ''
  const messagePart = message ? `: ${message}` : ''

  return `${timestamp} [${level}] ${category}${messagePart}${props}`
}

/**
 * Creates a sink that outputs to the console, mapping log levels to the
 * appropriate console method (debug, info, warn, error).
 *
 * @param options - Optional configuration including a custom formatter.
 */
export function getConsoleSink(options?: ConsoleSinkOptions): Sink {
  const formatter = options?.formatter ?? defaultFormatter

  return (record: LogRecord) => {
    const method = levelToConsoleMethod[record.level]
    const output = formatter(record)
    // eslint-disable-next-line no-console
    console[method](output)
  }
}

/**
 * Creates a non-blocking console sink that buffers log output and drains
 * it asynchronously via `setTimeout(0)`.
 *
 * Unlike {@link getConsoleSink}, which calls `console.*` synchronously on
 * every log call, this sink batches writes and flushes them in a single
 * macrotask. This yields the event loop between your application code and
 * log I/O, preventing high-throughput logging from stalling request handling.
 *
 * Returns a {@link DisposableSink} — call `flush()` on shutdown to ensure
 * all buffered output is written.
 */
export function getNonBlockingConsoleSink(options?: NonBlockingConsoleSinkOptions): DisposableSink {
  const formatter = options?.formatter ?? defaultFormatter
  const buffer: Array<{ method: 'debug' | 'info' | 'warn' | 'error'; text: string }> = []
  let drainScheduled = false
  let drainPromise: Promise<void> = Promise.resolve()
  let resolveDrain: (() => void) | null = null

  function drain() {
    const batch = buffer.splice(0)
    for (const { method, text } of batch) {
      // eslint-disable-next-line no-console
      console[method](text)
    }
    drainScheduled = false
    if (resolveDrain) {
      resolveDrain()
      resolveDrain = null
    }
  }

  const sink: Sink = (record: LogRecord) => {
    const method = levelToConsoleMethod[record.level]
    const text = formatter(record)
    buffer.push({ method, text })
    if (!drainScheduled) {
      drainScheduled = true
      drainPromise = new Promise((resolve) => {
        resolveDrain = resolve
      })
      setTimeout(drain, 0)
    }
  }

  const disposableSink = sink as DisposableSink

  disposableSink.flush = () => {
    if (buffer.length > 0) {
      drain()
    }
    return drainPromise
  }

  disposableSink[Symbol.asyncDispose] = () => disposableSink.flush()

  return disposableSink
}

/**
 * Wraps a sink with a filter, creating a new sink that only forwards
 * records that pass the filter predicate.
 */
export function withFilter(sink: Sink, filter: FilterLike): Sink {
  const filterFn = toFilter(filter)
  return (record: LogRecord) => {
    if (filterFn(record)) {
      sink(record)
    }
  }
}

/**
 * Wraps an async function as a synchronous {@link Sink}.
 *
 * Internally chains promises so that writes execute in order and each
 * write waits for the previous one to finish. Call `flush()` or use
 * `await using` to wait for all pending writes to complete.
 */
export function fromAsyncSink(fn: (record: LogRecord) => Promise<void>): DisposableSink {
  let pending: Promise<void> = Promise.resolve()

  const sink: Sink = (record: LogRecord) => {
    pending = pending.then(() => fn(record))
  }

  const disposableSink = sink as DisposableSink

  disposableSink.flush = () => pending

  disposableSink[Symbol.asyncDispose] = () => pending

  return disposableSink
}

/**
 * Creates a sink that writes formatted log records to a {@link WritableStream}.
 *
 * Acquires a writer from the stream internally and writes each record as a
 * UTF-8 encoded string followed by a newline. Built on {@link fromAsyncSink},
 * so writes are ordered and the returned sink supports `flush()` and
 * `Symbol.asyncDispose` for lifecycle management.
 *
 * Closing the writer (via `flush()` or disposal) does **not** close the
 * underlying stream — the caller retains ownership.
 */
export function getStreamSink(stream: WritableStream, options?: StreamSinkOptions): DisposableSink {
  let formatter: TextFormatter | undefined = options?.formatter
  let encoder: TextEncoder | undefined

  const writer = stream.getWriter()

  const sink = fromAsyncSink(async (record: LogRecord) => {
    if (formatter === undefined) {
      const { getTextFormatter } = await import('./formatter.ts')
      formatter = getTextFormatter()
    }
    if (encoder === undefined) {
      encoder = new TextEncoder()
    }
    const text = formatter(record) + '\n'
    await writer.write(encoder.encode(text))
  })

  const originalFlush = sink.flush
  sink.flush = async () => {
    await originalFlush()
    writer.releaseLock()
  }

  sink[Symbol.asyncDispose] = sink.flush

  return sink
}
