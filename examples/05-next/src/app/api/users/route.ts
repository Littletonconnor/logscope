import { withLogscope } from '@logscope/next'
import { log } from '@/lib/logscope'

// ============================================================================
// POST /api/users — route handler with request body on scope
// ============================================================================

export const POST = withLogscope(
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
    const body = await _req.json()

    logscope.scope.set({ body })
    logscope.requestLogger.info('creating new user', { name: body.name })

    // Simulate user creation
    const created = { id: 'user_new_123', ...body }
    logscope.scope.set({ createdUser: { id: created.id } })

    return Response.json(created, { status: 201 })
  },
)
