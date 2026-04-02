// --- GET /warn — returns 4xx with scope.warn() ---

export default defineEventHandler((event) => {
  const { scope } = event.context.logscope!

  scope.warn('resource not found — returning 404')
  scope.set({ lookup: { table: 'products', id: 'prod_999' } })

  throw createError({
    statusCode: 404,
    statusMessage: 'Product not found',
  })
})
