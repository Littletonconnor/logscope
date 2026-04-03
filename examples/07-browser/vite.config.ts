import { defineConfig } from 'vite'
import type { Plugin } from 'vite'

/**
 * Vite plugin that provides a mock log ingest endpoint.
 *
 * - POST /api/ingest  — accepts batches of LogRecords from createBrowserDrain
 * - GET  /api/ingest/history — returns all received batches (for the UI panel)
 *
 * Batches are also pretty-printed to the terminal so you can see what the
 * browser drain is sending.
 */
function mockIngestPlugin(): Plugin {
  interface IngestBatch {
    timestamp: string
    count: number
    records: unknown[]
  }

  const batches: IngestBatch[] = []

  // ANSI colors for terminal output
  const dim = '\x1b[2m'
  const bold = '\x1b[1m'
  const reset = '\x1b[0m'
  const cyan = '\x1b[36m'
  const yellow = '\x1b[33m'
  const red = '\x1b[31m'
  const green = '\x1b[32m'
  const magenta = '\x1b[35m'

  const levelColor: Record<string, string> = {
    trace: dim,
    debug: dim,
    info: green,
    warning: yellow,
    error: red,
    fatal: `${red}${bold}`,
  }

  return {
    name: 'mock-ingest',
    configureServer(server) {
      // POST /api/ingest — receive log batches
      server.middlewares.use('/api/ingest', (req, res, next) => {
        // Handle GET /api/ingest/history
        if (req.method === 'GET' && req.url === '/history') {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(batches))
          return
        }

        if (req.method !== 'POST') {
          next()
          return
        }

        let body = ''
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString()
        })
        req.on('end', () => {
          try {
            const records = JSON.parse(body)
            const batch: IngestBatch = {
              timestamp: new Date().toISOString(),
              count: Array.isArray(records) ? records.length : 1,
              records: Array.isArray(records) ? records : [records],
            }
            batches.push(batch)

            // Keep last 50 batches
            if (batches.length > 50) batches.splice(0, batches.length - 50)

            // Pretty-print to terminal
            console.log(
              `\n${magenta}${bold}--- Ingest batch (${batch.count} records) ---${reset}`,
            )
            for (const rec of batch.records as Array<{
              level?: string
              category?: string[]
              message?: unknown[]
              properties?: Record<string, unknown>
              timestamp?: number
            }>) {
              const level = (rec.level ?? 'info').toUpperCase().padEnd(7)
              const color = levelColor[rec.level ?? 'info'] ?? ''
              const cat = (rec.category ?? []).join(' \u00b7 ')
              const msg = (rec.message ?? []).join('')
              const ts = rec.timestamp
                ? `${dim}${new Date(rec.timestamp).toISOString()}${reset} `
                : ''
              const props = rec.properties && Object.keys(rec.properties).length > 0
                ? ` ${dim}${JSON.stringify(rec.properties)}${reset}`
                : ''

              console.log(
                `  ${ts}${color}${level}${reset} ${cyan}${cat}${reset}: ${msg}${props}`,
              )
            }

            res.statusCode = 204
            res.end()
          } catch {
            res.statusCode = 400
            res.end('Invalid JSON')
          }
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [mockIngestPlugin()],
  server: {
    port: 3005,
  },
})
