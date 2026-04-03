/**
 * Mock OTLP Collector
 *
 * Simulates an OpenTelemetry OTLP HTTP/JSON collector at POST /v1/logs.
 * Parses the ExportLogsServiceRequest payload and pretty-prints each batch
 * to the terminal so you can see exactly what the collector would receive.
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
const blue = (s: string) => `\x1b[34m${s}\x1b[39m`

const SEVERITY_COLORS: Record<string, (s: string) => string> = {
  TRACE: dim,
  DEBUG: cyan,
  INFO: green,
  WARN: yellow,
  ERROR: red,
  FATAL: (s: string) => `\x1b[1m\x1b[31m${s}\x1b[39m\x1b[22m`,
}

interface OtlpKeyValue {
  key: string
  value: OtlpAnyValue
}

type OtlpAnyValue =
  | { stringValue: string }
  | { intValue: string }
  | { doubleValue: number }
  | { boolValue: boolean }
  | { arrayValue: { values: OtlpAnyValue[] } }
  | { kvlistValue: { values: OtlpKeyValue[] } }

interface OtlpLogRecord {
  timeUnixNano?: string
  severityNumber?: number
  severityText?: string
  body?: OtlpAnyValue
  attributes?: OtlpKeyValue[]
}

interface ExportLogsServiceRequest {
  resourceLogs?: Array<{
    resource?: { attributes?: OtlpKeyValue[] }
    scopeLogs?: Array<{
      scope?: { name?: string; version?: string }
      logRecords?: OtlpLogRecord[]
    }>
  }>
}

/**
 * Extracts a simple display string from an OtlpAnyValue.
 */
function displayValue(val: OtlpAnyValue): string {
  if ('stringValue' in val) return val.stringValue
  if ('intValue' in val) return val.intValue
  if ('doubleValue' in val) return String(val.doubleValue)
  if ('boolValue' in val) return String(val.boolValue)
  if ('arrayValue' in val) return `[${val.arrayValue.values.map(displayValue).join(', ')}]`
  if ('kvlistValue' in val) {
    const pairs = val.kvlistValue.values.map((kv) => `${kv.key}=${displayValue(kv.value)}`)
    return `{${pairs.join(', ')}}`
  }
  return '(unknown)'
}

/**
 * Extracts resource attributes into a readable string.
 */
function formatResourceAttrs(attrs: OtlpKeyValue[] | undefined): string {
  if (!attrs || attrs.length === 0) return dim('(no resource attrs)')
  return attrs.map((a) => `${a.key}=${displayValue(a.value)}`).join(', ')
}

/**
 * Converts nanosecond timestamp to ISO string.
 */
function nanoToIso(nanos: string | undefined): string {
  if (!nanos) return '(no time)'
  const ms = Number(BigInt(nanos) / 1_000_000n)
  return new Date(ms).toISOString()
}

let batchCount = 0

const app = new Hono()

app.post('/v1/logs', async (c) => {
  const auth = c.req.header('authorization')

  let payload: ExportLogsServiceRequest
  try {
    payload = await c.req.json()
  } catch {
    console.log(red('  [mock-collector] Rejected: invalid JSON body'))
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  batchCount++

  const resourceLogs = payload.resourceLogs ?? []
  let totalRecords = 0

  for (const rl of resourceLogs) {
    for (const sl of rl.scopeLogs ?? []) {
      totalRecords += sl.logRecords?.length ?? 0
    }
  }

  // Print batch header
  console.log('')
  console.log(
    blue(`  ┌─ OTLP Batch #${batchCount} `) +
      dim(`(${totalRecords} record${totalRecords === 1 ? '' : 's'}) `) +
      (auth ? dim(`auth=${auth.slice(0, 20)}...`) : dim('(no auth)')),
  )

  for (const rl of resourceLogs) {
    const resourceStr = formatResourceAttrs(rl.resource?.attributes)
    console.log(blue('  │ ') + dim('Resource: ') + resourceStr)

    const scopeLogs = rl.scopeLogs ?? []
    for (let si = 0; si < scopeLogs.length; si++) {
      const sl = scopeLogs[si]
      const scopeName = sl.scope?.name ?? '(unnamed scope)'
      const scopeVersion = sl.scope?.version ? ` v${sl.scope.version}` : ''
      console.log(blue('  │ ') + dim('Scope: ') + cyan(scopeName) + dim(scopeVersion))

      const records = sl.logRecords ?? []
      for (let ri = 0; ri < records.length; ri++) {
        const rec = records[ri]
        const isLastRecord = si === scopeLogs.length - 1 && ri === records.length - 1
        const prefix = isLastRecord ? '  └──' : '  ├──'

        const severityText = rec.severityText ?? 'UNKNOWN'
        const colorFn = SEVERITY_COLORS[severityText] ?? dim
        const body = rec.body ? displayValue(rec.body) : ''
        const time = nanoToIso(rec.timeUnixNano)

        // Collect non-category attributes for display
        const attrs: string[] = []
        for (const attr of rec.attributes ?? []) {
          if (attr.key === 'log.category') continue
          attrs.push(`${attr.key}=${displayValue(attr.value)}`)
        }
        const attrsStr = attrs.length > 0 ? dim(` {${attrs.join(', ')}}`) : ''

        console.log(
          `${blue(prefix)} ${colorFn(`[${severityText}]`)} ${bold(body)}${attrsStr} ${dim(time)}`,
        )
      }
    }
  }

  console.log('')

  // OTLP collector responds with empty JSON on success
  return c.json({})
})

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }))

export function startMockCollector(port: number): Promise<void> {
  return new Promise((resolve) => {
    serve({ fetch: app.fetch, port }, () => {
      console.log(
        blue(`  [mock-collector] `) +
          `Mock OTLP collector running on http://localhost:${port}`,
      )
      console.log(
        blue(`  [mock-collector] `) +
          dim(`Accepting POST /v1/logs`),
      )
      resolve()
    })
  })
}
