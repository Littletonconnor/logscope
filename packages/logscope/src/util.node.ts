import { inspect as nodeInspect } from 'node:util'

/**
 * Converts any value into a human-readable string using Node.js `util.inspect`.
 */
export function inspect(value: unknown): string {
  if (typeof value === 'string') return value
  return nodeInspect(value, { depth: 4, colors: false })
}
