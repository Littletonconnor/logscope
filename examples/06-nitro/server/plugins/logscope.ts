import {
  configure,
  createLogger,
  getAnsiColorFormatter,
  getConsoleSink,
  getJsonFormatter,
  withFilter,
  getLevelFilter,
} from 'logscope'
import { logscope } from '@logscope/nitro'

// ============================================================================
// 1. Configure logscope
// ============================================================================

const log = createLogger('my-app')

await configure({
  sinks: {
    console: getConsoleSink({ formatter: getAnsiColorFormatter() }),
    json: withFilter(
      getConsoleSink({ formatter: getJsonFormatter() }),
      getLevelFilter('warning'),
    ),
  },
  loggers: [
    { category: 'my-app', level: 'debug', sinks: ['console', 'json'] },
  ],
})

// ============================================================================
// 2. Export the Nitro plugin
// ============================================================================

export default defineNitroPlugin(
  logscope({
    logger: log,
    // Custom request context extractor — add user-agent header
    getRequestContext: (event) => {
      const url = getRequestURL(event)
      return {
        method: getMethod(event),
        path: url.pathname,
        userAgent: getHeader(event, 'user-agent') ?? 'unknown',
      }
    },
    // Custom response context extractor — include content-type
    getResponseContext: (event) => ({
      response: {
        status: getResponseStatus(event),
        contentType: getResponseHeader(event, 'content-type') ?? 'unknown',
      },
    }),
  }),
)
