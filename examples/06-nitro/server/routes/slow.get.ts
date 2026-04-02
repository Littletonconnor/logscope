// --- GET /slow — simulated latency, shows duration tracking ---

import { setTimeout } from 'node:timers/promises'

export default defineEventHandler(async (event) => {
  const { scope, requestLogger } = event.context.logscope!

  requestLogger.info('starting slow operation')
  scope.set({ operation: 'heavy_computation' })

  // Simulate a slow operation (500ms)
  await setTimeout(500)

  requestLogger.info('slow operation completed')
  scope.set({ result: { rowsProcessed: 10_000 } })

  return { status: 'done', rowsProcessed: 10_000 }
})
