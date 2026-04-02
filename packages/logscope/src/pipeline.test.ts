import { describe, it, mock } from 'node:test'
import assert from 'node:assert'
import { createPipeline } from './pipeline.ts'
import type { LogRecord } from './record.ts'
import type { LogLevel } from './level.ts'
import type { Sink } from './sink.ts'

function makeRecord(level: LogLevel, overrides?: Partial<LogRecord>): LogRecord {
  return {
    category: ['test'],
    level,
    timestamp: Date.now(),
    message: ['test message'],
    rawMessage: 'test message',
    properties: {},
    ...overrides,
  }
}

describe('createPipeline', () => {
  it('batches records and flushes on size threshold', async () => {
    const batches: LogRecord[][] = []
    const pipeline = createPipeline({
      sink: async (batch) => {
        batches.push([...batch])
      },
      batch: { size: 3, intervalMs: 60000 },
    })

    pipeline(makeRecord('info', { properties: { seq: 1 } }))
    pipeline(makeRecord('info', { properties: { seq: 2 } }))
    pipeline(makeRecord('info', { properties: { seq: 3 } }))

    await pipeline.flush()

    assert.strictEqual(batches.length, 1)
    assert.strictEqual(batches[0].length, 3)
    assert.strictEqual(batches[0][0].properties.seq, 1)
    assert.strictEqual(batches[0][2].properties.seq, 3)
  })

  it('flushes incomplete batch on interval', async () => {
    const batches: LogRecord[][] = []
    const pipeline = createPipeline({
      sink: async (batch) => {
        batches.push([...batch])
      },
      batch: { size: 100, intervalMs: 20 },
    })

    pipeline(makeRecord('info'))

    // Wait for the interval to trigger
    await new Promise((resolve) => setTimeout(resolve, 50))
    await pipeline.flush()

    assert.strictEqual(batches.length, 1)
    assert.strictEqual(batches[0].length, 1)
  })

  it('flush drains all remaining records', async () => {
    const batches: LogRecord[][] = []
    const pipeline = createPipeline({
      sink: async (batch) => {
        batches.push([...batch])
      },
      batch: { size: 100, intervalMs: 60000 },
    })

    for (let i = 0; i < 5; i++) {
      pipeline(makeRecord('info', { properties: { seq: i } }))
    }

    await pipeline.flush()

    const allRecords = batches.flat()
    assert.strictEqual(allRecords.length, 5)
  })

  it('retries on failure with exponential backoff', async () => {
    let attempts = 0
    const pipeline = createPipeline({
      sink: async () => {
        attempts++
        if (attempts < 3) {
          throw new Error('temporary failure')
        }
      },
      batch: { size: 1 },
      maxAttempts: 3,
      backoff: 'exponential',
      baseDelayMs: 10,
    })

    pipeline(makeRecord('info'))
    await pipeline.flush()

    assert.strictEqual(attempts, 3)
  })

  it('calls onDropped after all retries exhausted', async () => {
    const dropped: { batch: readonly LogRecord[]; error: unknown }[] = []
    const pipeline = createPipeline({
      sink: async () => {
        throw new Error('permanent failure')
      },
      batch: { size: 1 },
      maxAttempts: 2,
      backoff: 'fixed',
      baseDelayMs: 5,
      onDropped: (batch, error) => {
        dropped.push({ batch, error })
      },
    })

    pipeline(makeRecord('info'))
    await pipeline.flush()

    assert.strictEqual(dropped.length, 1)
    assert.strictEqual(dropped[0].batch.length, 1)
    assert.ok(dropped[0].error instanceof Error)
    assert.strictEqual((dropped[0].error as Error).message, 'permanent failure')
  })

  it('drops oldest records when buffer exceeds maxBufferSize', async () => {
    const dropped: { batch: readonly LogRecord[]; error: unknown }[] = []
    const batches: LogRecord[][] = []
    const pipeline = createPipeline({
      sink: async (batch) => {
        batches.push([...batch])
      },
      batch: { size: 100, intervalMs: 60000 },
      maxBufferSize: 5,
      onDropped: (batch, error) => {
        dropped.push({ batch, error })
      },
    })

    // Add 7 records — only 5 should remain, 2 oldest dropped
    for (let i = 0; i < 7; i++) {
      pipeline(makeRecord('info', { properties: { seq: i } }))
    }

    await pipeline.flush()

    // Should have dropped 2 records total (one after record 6, one after record 7)
    const droppedRecords = dropped.flatMap((d) => [...d.batch])
    const flushedRecords = batches.flat()

    assert.strictEqual(droppedRecords.length + flushedRecords.length, 7)
    assert.ok(flushedRecords.length <= 5)
  })

  it('uses linear backoff strategy', async () => {
    const timestamps: number[] = []
    let attempts = 0
    const pipeline = createPipeline({
      sink: async () => {
        timestamps.push(Date.now())
        attempts++
        if (attempts < 3) {
          throw new Error('fail')
        }
      },
      batch: { size: 1 },
      maxAttempts: 3,
      backoff: 'linear',
      baseDelayMs: 20,
    })

    pipeline(makeRecord('info'))
    await pipeline.flush()

    assert.strictEqual(attempts, 3)
    // Linear: first retry ~20ms, second retry ~40ms
    const delay1 = timestamps[1] - timestamps[0]
    const delay2 = timestamps[2] - timestamps[1]
    assert.ok(delay1 >= 15, `first delay ${delay1}ms should be ~20ms`)
    assert.ok(delay2 >= 30, `second delay ${delay2}ms should be ~40ms`)
  })

  it('uses fixed backoff strategy', async () => {
    const timestamps: number[] = []
    let attempts = 0
    const pipeline = createPipeline({
      sink: async () => {
        timestamps.push(Date.now())
        attempts++
        if (attempts < 3) {
          throw new Error('fail')
        }
      },
      batch: { size: 1 },
      maxAttempts: 3,
      backoff: 'fixed',
      baseDelayMs: 20,
    })

    pipeline(makeRecord('info'))
    await pipeline.flush()

    assert.strictEqual(attempts, 3)
    // Fixed: both retries ~20ms
    const delay1 = timestamps[1] - timestamps[0]
    const delay2 = timestamps[2] - timestamps[1]
    assert.ok(delay1 >= 15, `first delay ${delay1}ms should be ~20ms`)
    assert.ok(delay2 >= 15, `second delay ${delay2}ms should be ~20ms`)
  })

  it('is assignable to Sink type', () => {
    const pipeline = createPipeline({
      sink: async () => {},
      batch: { size: 1 },
    })
    const regularSink: Sink = pipeline
    assert.strictEqual(typeof regularSink, 'function')
  })

  it('supports Symbol.asyncDispose', async () => {
    const batches: LogRecord[][] = []
    const pipeline = createPipeline({
      sink: async (batch) => {
        batches.push([...batch])
      },
      batch: { size: 100, intervalMs: 60000 },
    })

    pipeline(makeRecord('info'))
    await pipeline[Symbol.asyncDispose]()

    assert.strictEqual(batches.length, 1)
  })

  it('ignores records after dispose', async () => {
    const batches: LogRecord[][] = []
    const pipeline = createPipeline({
      sink: async (batch) => {
        batches.push([...batch])
      },
      batch: { size: 100, intervalMs: 60000 },
    })

    pipeline(makeRecord('info'))
    await pipeline.flush()

    // After flush (which sets disposed), new records should be ignored
    pipeline(makeRecord('error'))
    await pipeline.flush()

    const totalRecords = batches.flat().length
    assert.strictEqual(totalRecords, 1)
  })

  it('handles multiple batches correctly', async () => {
    const batches: LogRecord[][] = []
    const pipeline = createPipeline({
      sink: async (batch) => {
        batches.push([...batch])
      },
      batch: { size: 2, intervalMs: 60000 },
    })

    for (let i = 0; i < 5; i++) {
      pipeline(makeRecord('info', { properties: { seq: i } }))
    }

    await pipeline.flush()

    const allRecords = batches.flat()
    assert.strictEqual(allRecords.length, 5)
    // Should have been split into batches of 2, 2, 1
    assert.strictEqual(batches[0].length, 2)
    assert.strictEqual(batches[1].length, 2)
    assert.strictEqual(batches[2].length, 1)
  })
})
