// ---------------------------------------------------------------------------
// Context System – explicit (.with) and implicit (AsyncLocalStorage) context
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ContextLocalStorage – abstraction over AsyncLocalStorage (AD-12)
// ---------------------------------------------------------------------------

/**
 * Abstraction over Node.js AsyncLocalStorage (or any compatible implementation).
 * This decouples logscope from any specific runtime's async context API.
 *
 * On Node.js/Deno, pass a real `AsyncLocalStorage<Record<string, unknown>>`.
 * On browsers or other runtimes, this can be omitted — implicit context
 * simply won't be available, and all logging still works normally.
 */
export interface ContextLocalStorage<T> {
  getStore(): T | undefined
  run<R>(store: T, callback: () => R): R
}

// ---------------------------------------------------------------------------
// Module-level state – set by configure(), cleared by reset()
// ---------------------------------------------------------------------------

let storage: ContextLocalStorage<Record<string, unknown>> | null = null

/**
 * Sets the context local storage instance. Called by configure().
 * @internal
 */
export function setContextLocalStorage(
  cls: ContextLocalStorage<Record<string, unknown>> | undefined,
): void {
  storage = cls ?? null
}

/**
 * Clears the context local storage instance. Called by reset().
 * @internal
 */
export function clearContextLocalStorage(): void {
  storage = null
}

// ---------------------------------------------------------------------------
// withContext – runs a callback with implicit context attached
// ---------------------------------------------------------------------------

/**
 * Runs a callback with implicit context properties that are automatically
 * attached to all log records emitted within the callback scope.
 *
 * Requires `contextLocalStorage` to be provided in `configure()`.
 * If not configured, the callback runs normally without context injection.
 *
 * Contexts nest: inner calls inherit and override outer properties.
 *
 * @example
 * ```typescript
 * withContext({ requestId: 'req_abc' }, () => {
 *   log.info('handling request')  // requestId automatically attached
 *
 *   withContext({ userId: '123' }, () => {
 *     log.info('user action')  // both requestId and userId attached
 *   })
 * })
 * ```
 */
export function withContext<R>(
  properties: Record<string, unknown>,
  callback: () => R,
): R {
  if (storage === null) {
    // No storage configured — just run the callback without context
    return callback()
  }

  // Merge with any existing context (nesting support)
  const existing = storage.getStore()
  const merged = existing ? { ...existing, ...properties } : { ...properties }

  return storage.run(merged, callback)
}

// ---------------------------------------------------------------------------
// getImplicitContext – retrieves current implicit context
// ---------------------------------------------------------------------------

/**
 * Returns the current implicit context from the configured storage,
 * or undefined if no storage is configured or no context is active.
 *
 * Called internally by the logger's emit path to merge implicit context
 * into log records.
 *
 * @internal
 */
export function getImplicitContext(): Record<string, unknown> | undefined {
  if (storage === null) return undefined
  return storage.getStore()
}
