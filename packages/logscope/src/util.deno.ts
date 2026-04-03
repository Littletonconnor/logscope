declare const Deno: {
  inspect(value: unknown, options?: { depth?: number }): string
}

/**
 * Converts any value into a human-readable string using Deno's built-in `Deno.inspect`.
 */
export function inspect(value: unknown): string {
  if (typeof value === 'string') return value
  return Deno.inspect(value, { depth: 4 })
}
