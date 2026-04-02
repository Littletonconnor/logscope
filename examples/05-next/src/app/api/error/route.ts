import { withLogscope } from '@logscope/next'
import { log } from '@/lib/logscope'

// ============================================================================
// GET /api/error — throws an error, shows automatic error capture
// ============================================================================

export const GET = withLogscope(
  {
    logger: log,
    getRequestContext: (req) => ({
      method: req.method,
      path: new URL(req.url).pathname,
    }),
    getResponseContext: (_req, res) => ({
      response: { status: res.status },
    }),
  },
  async (_req, { logscope }) => {
    logscope.scope.set({ action: 'dangerous_operation' })

    // withLogscope catches this, records it on the scope via scope.error(),
    // emits the wide event at error level, then rethrows
    throw new Error('Something went terribly wrong!')
  },
)
