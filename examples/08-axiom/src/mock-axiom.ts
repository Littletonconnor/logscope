/**
 * Mock Axiom Ingest Server
 *
 * Simulates the Axiom Ingest API at POST /v1/datasets/:dataset/ingest.
 * Validates the auth header, parses the event payload, and pretty-prints
 * each batch to the terminal so you can see exactly what Axiom would receive.
 */

import { Hono } from 'hono'
import { serve } from '@hono/node-server'

// ANSI color helpers
const dim = (s: string) => `\x1b[2m${s}\x1b[22m`
const bold = (s: string) => `\x1b[1m${s}\x1b[22m`
const green = (s: string) => `\x1b[32m${s}\x1b[39m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[39m`
const red = (s: string) => `\x1b[31m${s}\x1b[39m`
const cyan = (s: string) => `\x1b[36m${s}\x1b[39m`
const magenta = (s: string) => `\x1b[35m${s}\x1b[39m`

const LEVEL_COLORS: Record<string, (s: string) => string> = {
  TRACE: dim,
  DEBUG: cyan,
  INFO: green,
  WARN: yellow,
  ERROR: red,
  FATAL: (s: string) => `\x1b[1m\x1b[31m${s}\x1b[39m\x1b[22m`,
}

let batchCount = 0

const app = new Hono()

app.post('/v1/datasets/:dataset/ingest', async (c) => {
  const dataset = c.req.param('dataset')
  const auth = c.req.header('authorization')

  // Validate auth header format
  if (!auth || !auth.startsWith('Bearer ')) {
    console.log(red('  [mock-axiom] Rejected: missing or invalid Authorization header'))
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const token = auth.slice('Bearer '.length)

  let events: unknown[]
  try {
    events = await c.req.json()
  } catch {
    console.log(red('  [mock-axiom] Rejected: invalid JSON body'))
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  if (!Array.isArray(events)) {
    console.log(red('  [mock-axiom] Rejected: body is not an array'))
    return c.json({ error: 'Expected array' }, 400)
  }

  batchCount++

  // Pretty-print the batch
  console.log('')
  console.log(
    magenta(`  ┌─ Axiom Batch #${batchCount} `) +
      dim(`(${events.length} event${events.length === 1 ? '' : 's'}) `) +
      dim(`dataset=${bold(dataset)} token=${token.slice(0, 8)}...`),
  )

  for (let i = 0; i < events.length; i++) {
    const event = events[i] as Record<string, unknown>
    const isLast = i === events.length - 1
    const prefix = isLast ? '  └──' : '  ├──'
    const level = String(event.level ?? 'UNKNOWN')
    const colorFn = LEVEL_COLORS[level] ?? dim
    const time = event._time ? dim(String(event._time)) : dim('(no time)')
    const logger = event.logger ? cyan(String(event.logger)) : dim('(no logger)')
    const message = event.message ? ` ${String(event.message)}` : ''

    // Collect extra fields (everything except _time, level, logger, message)
    const extra: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(event)) {
      if (!['_time', 'level', 'logger', 'message'].includes(key)) {
        extra[key] = value
      }
    }

    const extraStr =
      Object.keys(extra).length > 0 ? dim(` ${JSON.stringify(extra)}`) : ''

    console.log(
      `${magenta(prefix)} ${colorFn(`[${level}]`)} ${logger}${bold(message)}${extraStr} ${time}`,
    )
  }

  console.log('')

  // Axiom responds with 200 and an ingest status
  return c.json({
    ingested: events.length,
    failed: 0,
    failures: [],
    processedBytes: JSON.stringify(events).length,
  })
})

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }))

export function startMockAxiom(port: number): Promise<void> {
  return new Promise((resolve) => {
    serve({ fetch: app.fetch, port }, () => {
      console.log(
        magenta(`  [mock-axiom] `) +
          `Mock Axiom ingest server running on http://localhost:${port}`,
      )
      console.log(
        magenta(`  [mock-axiom] `) +
          dim(`Accepting POST /v1/datasets/:dataset/ingest`),
      )
      resolve()
    })
  })
}
