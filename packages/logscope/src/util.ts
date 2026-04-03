/**
 * Converts any value into a human-readable string representation.
 * Handles circular references, undefined, BigInt, functions, symbols,
 * and Error objects that JSON.stringify cannot serialize.
 */
export function inspect(value: unknown): string {
  // Handle primitives that JSON.stringify mangles or drops
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'function') {
    return `[Function: ${value.name || 'anonymous'}]`
  }
  if (typeof value === 'symbol') {
    return value.toString()
  }
  if (typeof value === 'bigint') {
    return `${value}n`
  }

  // Handle Error objects specially to include name, message, and stack
  if (value instanceof Error) {
    const parts = [`${value.name}: ${value.message}`]
    if (value.stack) {
      parts.push(value.stack)
    }
    if (value.cause !== undefined) {
      parts.push(`[cause]: ${inspect(value.cause)}`)
    }
    return parts.join('\n')
  }

  // For strings, return as-is (no quotes) for message rendering
  if (typeof value === 'string') return value

  // For numbers and booleans, use String()
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  // For objects and arrays, use JSON.stringify with circular reference detection
  const seen = new WeakSet()

  try {
    return JSON.stringify(value, function (_key: string, val: unknown): unknown {
      if (typeof val === 'bigint') return `${val}n`
      if (typeof val === 'undefined') return '[undefined]'
      if (typeof val === 'function') {
        return `[Function: ${val.name || 'anonymous'}]`
      }
      if (typeof val === 'symbol') return val.toString()

      if (val !== null && typeof val === 'object') {
        if (val instanceof Error) {
          return { name: val.name, message: val.message, stack: val.stack }
        }
        if (seen.has(val)) return '[Circular]'
        seen.add(val)
      }

      return val
    })
  } catch {
    return String(value)
  }
}
