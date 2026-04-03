import { configure, createBrowserDrain, createLogger, getConsoleSink } from 'logscope'
import type { Scope } from 'logscope'

// ---------------------------------------------------------------------------
// 1. Configure logscope with a browser drain + console sink
// ---------------------------------------------------------------------------

const browserDrain = createBrowserDrain({
  endpoint: '/api/ingest',
  batch: { size: 5, intervalMs: 3000 },
  onDropped: (batch, error) => {
    console.warn(`[logscope] Dropped ${batch.length} records:`, error)
  },
})

await configure({
  sinks: {
    remote: browserDrain,
    console: getConsoleSink(),
  },
  loggers: [
    { category: 'browser-app', sinks: ['remote', 'console'], level: 'debug' },
  ],
})

const log = createLogger('browser-app')

// ---------------------------------------------------------------------------
// 2. Quick log buttons
// ---------------------------------------------------------------------------

let infoCount = 0
let warnCount = 0
let errorCount = 0

document.getElementById('btn-info')!.addEventListener('click', () => {
  infoCount++
  log.info('button clicked', { button: 'info', count: infoCount })
  pollIngest()
})

document.getElementById('btn-warn')!.addEventListener('click', () => {
  warnCount++
  log.warning('something looks off', {
    button: 'warn',
    count: warnCount,
    details: 'This is a simulated warning',
  })
  pollIngest()
})

document.getElementById('btn-error')!.addEventListener('click', () => {
  errorCount++
  log.error('something went wrong', {
    button: 'error',
    count: errorCount,
    error: { name: 'SimulatedError', message: 'This is a test error' },
  })
  pollIngest()
})

// ---------------------------------------------------------------------------
// 3. Scoped wide event buttons
// ---------------------------------------------------------------------------

let activeScope: Scope | null = null
let scopeStep = 0

const btnStart = document.getElementById('btn-scope-start') as HTMLButtonElement
const btnCtx = document.getElementById('btn-scope-ctx') as HTMLButtonElement
const btnEmit = document.getElementById('btn-scope-emit') as HTMLButtonElement
const scopeStatus = document.getElementById('scope-status')!

function updateScopeUI(message: string, active: boolean) {
  scopeStatus.textContent = message
  btnStart.disabled = active
  btnCtx.disabled = !active
  btnEmit.disabled = !active
  if (active) {
    btnStart.classList.add('active')
  } else {
    btnStart.classList.remove('active')
  }
}

btnStart.addEventListener('click', () => {
  activeScope = log.scope({ action: 'checkout', startedBy: 'user' })
  scopeStep = 0
  updateScopeUI('Scope active — add context or emit', true)
})

const contextSteps = [
  { user: { id: 'usr_42', plan: 'premium' } },
  { cart: { items: 3, total: 89.97, currency: 'USD' } },
  { payment: { method: 'card', last4: '4242' } },
  { shipping: { method: 'express', estimatedDays: 2 } },
]

btnCtx.addEventListener('click', () => {
  if (!activeScope) return
  const ctx = contextSteps[scopeStep % contextSteps.length]
  activeScope.set(ctx)
  scopeStep++
  updateScopeUI(
    `Added context (${scopeStep} field${scopeStep > 1 ? 's' : ''}) — add more or emit`,
    true,
  )
})

btnEmit.addEventListener('click', () => {
  if (!activeScope) return
  activeScope.emit({ completedAt: new Date().toISOString() })
  updateScopeUI(`Scope emitted with ${scopeStep} context fields`, false)
  activeScope = null
  scopeStep = 0
  pollIngest()
})

// ---------------------------------------------------------------------------
// 4. Poll the mock ingest endpoint for display
// ---------------------------------------------------------------------------

const logOutput = document.getElementById('log-output')!

const levelColorClass: Record<string, string> = {
  info: 'log-level-info',
  debug: 'log-level-debug',
  warning: 'log-level-warning',
  error: 'log-level-error',
  fatal: 'log-level-error',
}

async function pollIngest() {
  // Small delay to let the batch potentially flush
  await new Promise((r) => setTimeout(r, 500))

  try {
    const res = await fetch('/api/ingest/history')
    if (!res.ok) return
    const batches: { timestamp: string; count: number; records: Array<{
      level: string
      category: string[]
      message: unknown[]
      properties: Record<string, unknown>
      timestamp: number
    }> }[] = await res.json()

    logOutput.innerHTML = ''

    for (const batch of batches) {
      const header = document.createElement('div')
      header.className = 'log-batch-header'
      header.textContent = `--- Batch (${batch.count} records) @ ${batch.timestamp} ---`
      logOutput.appendChild(header)

      for (const rec of batch.records) {
        const entry = document.createElement('div')
        entry.className = `log-entry ${levelColorClass[rec.level] ?? ''}`

        const level = rec.level.toUpperCase().padEnd(7)
        const cat = rec.category.join(' \u00b7 ')
        const msg = rec.message.join('')
        const props = Object.keys(rec.properties).length > 0
          ? ' ' + JSON.stringify(rec.properties)
          : ''

        entry.textContent = `${level} ${cat}: ${msg}${props}`
        logOutput.appendChild(entry)
      }
    }

    logOutput.scrollTop = logOutput.scrollHeight
  } catch {
    // Ingest endpoint not ready yet, ignore
  }
}

// Also poll periodically to catch timer-based flushes and visibility-change flushes
setInterval(pollIngest, 4000)

// Initial log
log.info('browser logging initialized', { drainEndpoint: '/api/ingest' })

// Poll once on load
setTimeout(pollIngest, 1000)
