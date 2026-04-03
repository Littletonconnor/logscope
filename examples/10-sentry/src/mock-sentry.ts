/**
 * Mock Sentry Envelope Endpoint
 *
 * Simulates the Sentry Envelope API at POST /api/:projectId/envelope/.
 * Parses the envelope format (newline-delimited JSON), extracts event data,
 * and pretty-prints each event to the terminal so you can see exactly what
 * Sentry would receive — including exception chains and stack frames.
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
  debug: cyan,
  info: green,
  warning: yellow,
  error: red,
  fatal: (s: string) => `\x1b[1m\x1b[31m${s}\x1b[39m\x1b[22m`,
}

interface SentryStackFrame {
  filename?: string
  function?: string
  lineno?: number
  colno?: number
  in_app?: boolean
}

interface SentryExceptionValue {
  type: string
  value: string
  stacktrace?: {
    frames: SentryStackFrame[]
  }
}

interface SentryEvent {
  event_id?: string
  timestamp?: number
  level?: string
  logger?: string
  platform?: string
  message?: { formatted: string }
  extra?: Record<string, unknown>
  exception?: { values: SentryExceptionValue[] }
  tags?: Record<string, string>
}

interface EnvelopeHeader {
  event_id?: string
  dsn?: string
  sent_at?: string
}

interface ItemHeader {
  type?: string
  content_type?: string
}

/**
 * Parses a Sentry envelope body into individual events.
 *
 * Envelope format: groups of 3 lines per event:
 *   Line 1: envelope header JSON (event_id, dsn, sent_at)
 *   Line 2: item header JSON (type, content_type)
 *   Line 3: event payload JSON
 */
function parseEnvelope(body: string): Array<{ header: EnvelopeHeader; itemHeader: ItemHeader; event: SentryEvent }> {
  const lines = body.split('\n').filter((line) => line.trim().length > 0)
  const events: Array<{ header: EnvelopeHeader; itemHeader: ItemHeader; event: SentryEvent }> = []

  for (let i = 0; i + 2 < lines.length; i += 3) {
    try {
      const header = JSON.parse(lines[i]) as EnvelopeHeader
      const itemHeader = JSON.parse(lines[i + 1]) as ItemHeader
      const event = JSON.parse(lines[i + 2]) as SentryEvent
      events.push({ header, itemHeader, event })
    } catch {
      console.log(red(`  [mock-sentry] Failed to parse envelope lines ${i}-${i + 2}`))
    }
  }

  return events
}

/**
 * Formats a Unix timestamp (seconds with fractional ms) to ISO string.
 */
function formatTimestamp(ts: number | undefined): string {
  if (ts === undefined) return '(no time)'
  return new Date(ts * 1000).toISOString()
}

let eventCount = 0

const app = new Hono()

app.post('/api/:projectId/envelope/', async (c) => {
  const projectId = c.req.param('projectId')
  const sentryAuth = c.req.header('x-sentry-auth')

  // Validate auth header format
  if (!sentryAuth || !sentryAuth.startsWith('Sentry ')) {
    console.log(red('  [mock-sentry] Rejected: missing or invalid X-Sentry-Auth header'))
    return c.json({ error: 'Unauthorized' }, 401)
  }

  // Extract sentry_key from the auth header
  const keyMatch = sentryAuth.match(/sentry_key=([^,\s]+)/)
  const sentryKey = keyMatch ? keyMatch[1] : '(unknown)'

  const body = await c.req.text()
  const envelopes = parseEnvelope(body)

  if (envelopes.length === 0) {
    console.log(red('  [mock-sentry] Rejected: no valid events in envelope'))
    return c.json({ error: 'Empty envelope' }, 400)
  }

  for (const { header, event } of envelopes) {
    eventCount++

    const level = event.level ?? 'unknown'
    const colorFn = LEVEL_COLORS[level] ?? dim
    const logger = event.logger ?? '(no logger)'
    const eventId = (event.event_id ?? header.event_id ?? '(no id)').slice(0, 12)
    const time = formatTimestamp(event.timestamp)

    // Print event header
    console.log('')
    console.log(
      magenta(`  ┌─ Sentry Event #${eventCount} `) +
        dim(`project=${projectId} key=${sentryKey.slice(0, 8)}...`),
    )
    console.log(
      magenta('  │ ') +
        colorFn(`[${level.toUpperCase()}]`) +
        ` ${cyan(logger)}` +
        ` ${dim(`id=${eventId}...`)}` +
        ` ${dim(time)}`,
    )

    // Print message
    if (event.message?.formatted) {
      console.log(
        magenta('  │ ') + bold('Message: ') + event.message.formatted,
      )
    }

    // Print tags
    if (event.tags && Object.keys(event.tags).length > 0) {
      const tagStr = Object.entries(event.tags)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')
      console.log(magenta('  │ ') + dim('Tags: ') + tagStr)
    }

    // Print exception chain
    if (event.exception?.values && event.exception.values.length > 0) {
      const exceptions = event.exception.values
      console.log(magenta('  │ ') + red(bold('Exception Chain:')))

      for (let i = 0; i < exceptions.length; i++) {
        const exc = exceptions[i]
        const isLast = i === exceptions.length - 1
        const excPrefix = isLast ? '  │  └──' : '  │  ├──'

        console.log(
          magenta(excPrefix) +
            ` ${red(bold(exc.type))}: ${exc.value}`,
        )

        // Print top stack frames (limit to 3 for readability)
        if (exc.stacktrace?.frames && exc.stacktrace.frames.length > 0) {
          // Sentry frames are oldest-first, show newest-first for readability
          const frames = [...exc.stacktrace.frames].reverse()
          const shown = frames.slice(0, 3)
          const more = frames.length - shown.length

          for (const frame of shown) {
            const fn = frame.function ?? '(anonymous)'
            const file = frame.filename ?? '(unknown)'
            const loc = frame.lineno ? `:${frame.lineno}${frame.colno ? `:${frame.colno}` : ''}` : ''
            const inApp = frame.in_app ? '' : dim(' [node_modules]')
            console.log(
              magenta('  │     ') + dim(`at ${fn} (${file}${loc})`) + inApp,
            )
          }
          if (more > 0) {
            console.log(magenta('  │     ') + dim(`... ${more} more frame${more === 1 ? '' : 's'}`))
          }
        }
      }
    }

    // Print extra data
    if (event.extra && Object.keys(event.extra).length > 0) {
      const extraStr = JSON.stringify(event.extra, null, 2)
        .split('\n')
        .map((line, i) => (i === 0 ? line : `  │   ${line}`))
        .join('\n')
      console.log(magenta('  │ ') + dim('Extra: ') + dim(extraStr))
    }

    console.log(magenta('  └─'))
  }

  console.log('')

  // Sentry responds with event IDs
  return c.json({
    id: envelopes[0]?.event.event_id ?? 'unknown',
  })
})

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }))

export function startMockSentry(port: number): Promise<void> {
  return new Promise((resolve) => {
    serve({ fetch: app.fetch, port }, () => {
      console.log(
        magenta(`  [mock-sentry] `) +
          `Mock Sentry endpoint running on http://localhost:${port}`,
      )
      console.log(
        magenta(`  [mock-sentry] `) +
          dim(`Accepting POST /api/:projectId/envelope/`),
      )
      resolve()
    })
  })
}
