'use server'

import { withLogscopeAction } from '@logscope/next'
import { log } from '@/lib/logscope'

// ============================================================================
// Server action wrapped with logscope — emits a wide event on completion
// ============================================================================

export const submitForm = withLogscopeAction(
  { logger: log, actionName: 'submitForm' },
  async (logscope, formData: FormData) => {
    const name = formData.get('name') as string
    const email = formData.get('email') as string

    // Accumulate context on the scope
    logscope.scope.set({ form: { name, email } })

    // Use requestLogger for within-action structured logs
    logscope.requestLogger.info('processing form submission', { name, email })

    // Simulate some async work (e.g. saving to DB)
    await new Promise((resolve) => setTimeout(resolve, 100))

    logscope.scope.set({ result: { saved: true, userId: 'user_new_456' } })
    logscope.requestLogger.info('user created successfully')
  },
)
