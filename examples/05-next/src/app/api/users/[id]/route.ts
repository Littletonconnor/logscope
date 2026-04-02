import { withLogscope } from '@logscope/next'
import { log } from '@/lib/logscope'

// ============================================================================
// GET /api/users/:id — route handler with scope context
// ============================================================================

export const GET = withLogscope(
  {
    logger: log,
    getRequestContext: (req) => ({
      method: req.method,
      path: new URL(req.url).pathname,
      userAgent: req.headers.get('user-agent') ?? 'unknown',
    }),
    getResponseContext: (_req, res) => ({
      response: { status: res.status },
    }),
  },
  async (req, { params, logscope }) => {
    const { id } = await params

    // Add user context to the wide event
    logscope.scope.set({ user: { id, source: 'url_param' } })

    // Use requestLogger for within-request structured logs
    logscope.requestLogger.info('fetching user from database', { userId: id })

    // Simulate a DB lookup
    const user = { id, name: 'Alice', plan: 'premium' }

    logscope.requestLogger.info('user found', { userId: id, plan: user.plan })
    logscope.scope.set({ user: { name: user.name, plan: user.plan } })

    return Response.json(user)
  },
)
