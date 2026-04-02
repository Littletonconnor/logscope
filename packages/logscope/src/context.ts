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

/**
 * Hidden key for storing category prefix in the context store.
 * Symbol properties are invisible to {...spread} and Object.keys(),
 * so the prefix never leaks into log record properties.
 * @internal
 */
export const CATEGORY_PREFIX_KEY = Symbol.for('logscope.categoryPrefix')

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

  // Carry forward category prefix — Symbol keys aren't copied by spread
  if (existing && CATEGORY_PREFIX_KEY in existing) {
    ;(merged as Record<symbol, unknown>)[CATEGORY_PREFIX_KEY] =
      (existing as Record<symbol, unknown>)[CATEGORY_PREFIX_KEY]
  }

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

// ---------------------------------------------------------------------------
// withCategoryPrefix – runs a callback with a category prefix active
// ---------------------------------------------------------------------------

/**
 * Runs a callback where any `createLogger()` calls automatically have
 * the given prefix prepended to their category.
 *
 * Useful for SDK/library authors who want to namespace their internal
 * logging without requiring consumers to know about it.
 *
 * Requires `contextLocalStorage` to be provided in `configure()`.
 * If not configured, the callback runs normally without prefix injection.
 *
 * Prefixes nest: inner prefixes are appended to outer ones.
 *
 * @example
 * ```typescript
 * withCategoryPrefix('my-sdk', () => {
 *   const log = createLogger('http')  // category: ['my-sdk', 'http']
 *   log.info('request sent')
 *
 *   withCategoryPrefix('internal', () => {
 *     const inner = createLogger('cache')  // category: ['my-sdk', 'internal', 'cache']
 *     inner.info('cache hit')
 *   })
 * })
 * ```
 */
export function withCategoryPrefix<R>(
  prefix: string | readonly string[],
  callback: () => R,
): R {
  if (storage === null) {
    return callback()
  }

  const prefixParts = typeof prefix === 'string' ? [prefix] : [...prefix]
  const existing = storage.getStore()

  // Stack on any existing prefix
  const existingPrefix = existing
    ? ((existing as Record<symbol, unknown>)[CATEGORY_PREFIX_KEY] as
        | string[]
        | undefined)
    : undefined
  const newPrefix = existingPrefix
    ? [...existingPrefix, ...prefixParts]
    : prefixParts

  // Copy existing context properties + set the new prefix
  const merged = existing ? { ...existing } : {}
  ;(merged as Record<symbol, unknown>)[CATEGORY_PREFIX_KEY] = newPrefix

  return storage.run(merged, callback)
}

// ---------------------------------------------------------------------------
// getCategoryPrefix – retrieves current category prefix
// ---------------------------------------------------------------------------

/**
 * Returns the current category prefix from the context storage,
 * or undefined if none is active.
 *
 * Called internally by `createLogger()` to prepend prefix segments.
 *
 * @internal
 */
export function getCategoryPrefix(): readonly string[] | undefined {
  if (storage === null) return undefined
  const store = storage.getStore()
  if (!store) return undefined
  return (store as Record<symbol, unknown>)[CATEGORY_PREFIX_KEY] as
    | string[]
    | undefined
}
