import { AsyncLocalStorage } from 'node:async_hooks'

import {
  configure,
  createLogger,
  getAnsiColorFormatter,
  getConsoleSink,
  getJsonFormatter,
  getLevelFilter,
  withFilter,
} from 'logscope'

// ============================================================================
// Shared logscope configuration for the Next.js app
// ============================================================================

export const log = createLogger('my-next-app')

await configure({
  sinks: {
    console: getConsoleSink({ formatter: getAnsiColorFormatter() }),
    json: withFilter(
      getConsoleSink({ formatter: getJsonFormatter() }),
      getLevelFilter('warning'),
    ),
  },
  loggers: [
    { category: 'my-next-app', level: 'debug', sinks: ['console', 'json'] },
  ],
  contextLocalStorage: new AsyncLocalStorage<Record<string, unknown>>(),
})
