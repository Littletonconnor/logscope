// --- GET /error — throws an error, scope emits at error level ---

export default defineEventHandler((event) => {
  const { scope } = event.context.logscope!
  scope.set({ action: 'dangerous_operation' })

  // This error is caught by the Nitro error hook in the logscope plugin,
  // recorded on the scope, and the wide event emits at error level
  throw createError({
    statusCode: 500,
    statusMessage: 'Something went terribly wrong!',
  })
})
