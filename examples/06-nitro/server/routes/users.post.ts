// --- POST /users — parses body, adds to scope ---

export default defineEventHandler(async (event) => {
  const { scope, requestLogger } = event.context.logscope!

  const body = await readBody(event)
  scope.set({ body })

  requestLogger.info('creating new user', { name: body.name })

  // Simulate user creation
  const created = { id: 'user_new_123', ...body }
  scope.set({ createdUser: { id: created.id } })

  setResponseStatus(event, 201)
  return created
})
