/**
 * Cross-runtime value inspection — Node.js implementation.
 * Uses Node's built-in util.inspect for rich output.
 */

import { inspect as nodeInspect } from 'node:util'

/**
 * Converts any value into a human-readable string representation
 * using Node.js's built-in util.inspect.
 */
export function inspect(value: unknown): string {
  if (typeof value === 'string') return value
  return nodeInspect(value, { depth: 4, colors: false })
}
