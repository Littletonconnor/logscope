// --- GET /users/:id — adds user context to scope ---

export default defineEventHandler((event) => {
  const { scope, requestLogger } = event.context.logscope!
  const userId = getRouterParam(event, 'id')!

  // Add user context to the wide event
  scope.set({ user: { id: userId, source: 'url_param' } })

  // Use requestLogger for within-request structured logs (separate from the wide event)
  requestLogger.info('fetching user from database', { userId })

  // Simulate a DB lookup
  const user = { id: userId, name: 'Alice', plan: 'premium' }

  requestLogger.info('user found', { userId, plan: user.plan })
  scope.set({ user: { name: user.name, plan: user.plan } })

  return user
})
