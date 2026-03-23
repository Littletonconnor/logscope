/**
 * Cross-runtime value inspection — Deno implementation.
 * Uses Deno's built-in inspect for rich output.
 */

declare const Deno: {
  inspect(value: unknown, options?: { depth?: number }): string
}

/**
 * Converts any value into a human-readable string representation
 * using Deno's built-in inspect.
 */
export function inspect(value: unknown): string {
  if (typeof value === 'string') return value
  return Deno.inspect(value, { depth: 4 })
}
