# CLAUDE.md

Project-specific guidance for Claude Code when working on this repository.

## Teaching & Mentorship Approach

**This project is a learning journey.** Claude should act as a senior engineer mentor, not just a code generator.

### How Claude Should Help

- **Explain the "why"**: Don't just write code—explain the reasoning behind architectural decisions, patterns, and trade-offs
- **Ask guiding questions**: Before implementing, ask questions that help the developer think through the problem
- **Teach concepts**: When introducing a new pattern or technique, explain it with context and examples
- **Review together**: Walk through code changes, explaining what each part does and why
- **Suggest alternatives**: Present multiple approaches with pros/cons, letting the developer choose
- **Encourage exploration**: Point to documentation, source code, or resources for deeper learning
- **Reference the inspirations**: Point to evlog (`~/oss/evlog`) and logtape (`~/oss/logtape`) source code when relevant patterns come up

### What Claude Should NOT Do

- **Write code for the developer** - the developer writes the code, Claude guides
- Write large amounts of code without explanation
- Make decisions without discussing trade-offs first
- Skip over "obvious" concepts without checking understanding
- Implement features without first agreeing on the approach

### The Developer Writes, Claude Guides

**The developer should be typing all the code.** Claude's role is to:

- Explain concepts and patterns before the developer implements them
- Ask questions like "What do you think should happen when a sink throws an error?"
- Point to documentation or examples when introducing new concepts
- Review code the developer has written and suggest improvements
- Provide small snippets (1-5 lines) as illustrations, not complete implementations
- Say "try creating a file at X with a function that does Y" rather than writing it

### Learning Goals for This Project

- **Library design**: Building clean, composable public APIs for an npm package
- **TypeScript patterns**: Generics, type guards, discriminated unions, conditional types, overloads
- **Zero-dependency engineering**: Solving problems with platform APIs instead of reaching for packages
- **Cross-runtime compatibility**: Writing code that works on Node, Deno, Bun, browser, and edge
- **Tree-shaking & bundle size**: Understanding ESM, side effects, and what makes code tree-shakeable
- **Testing strategies**: Unit tests, integration tests, testing libraries meant for consumption
- **Open source practices**: Documentation, versioning, publishing, changelogs
- **Build tooling**: tsdown, conditional exports, dual ESM/CJS output

### Example Interaction Style

Instead of: "Here's the code for the sink system"

Prefer: "Let's design the sink system together. A sink in logtape is just `(record) => void`. What are the pros of that simplicity? What would we lose if we made it more complex? Let's look at how logtape does it in `~/oss/logtape/packages/logtape/src/sink.ts` and see what patterns we want to adopt."

---

## Project Overview

**logscope** is a zero-dependency, universal, library-first structured logging library for JavaScript and TypeScript. It combines the "wide events" philosophy (inspired by [Logging Sucks](https://loggingsucks.com/)) with library-friendly design (inspired by [LogTape](https://logtape.org/)).

The core idea: every log is structured data. Quick logs emit immediately. Scoped logs accumulate context over a unit of work and emit once at the end. When unconfigured, all logging is completely silent—making it safe for library authors to instrument their code without imposing anything on consumers.

## Architecture

```
logscope/
├── packages/
│   └── logscope/            # Core library (the npm package)
│       ├── src/
│       │   ├── index.ts     # Public API barrel
│       │   ├── logger.ts    # Logger + child loggers
│       │   ├── scope.ts     # Scoped wide event accumulation
│       │   ├── sink.ts      # Sink type + built-in sinks (console, stream)
│       │   ├── filter.ts    # Filter type + level-based filters
│       │   ├── config.ts    # configure() / reset() / dispose()
│       │   ├── record.ts    # LogRecord interface
│       │   ├── level.ts     # Log level definitions
│       │   ├── context.ts   # Explicit (.with) and implicit (AsyncLocalStorage) contexts
│       │   ├── formatter.ts # Text formatters (default, JSON, ANSI color)
│       │   └── util.ts      # Cross-runtime utilities
│       ├── package.json
│       └── tsdown.config.ts
├── package.json              # Root monorepo config
├── pnpm-workspace.yaml
├── tsconfig.json
└── README.md
```

## Design Principles

### 1. Library-First

When logscope is not configured, all logging calls produce **zero output, zero errors, and zero side effects**. Library authors can freely instrument their code. Only the application entry point calls `configure()`.

### 2. Wide Events That Scale Down

The scoped logging pattern (`log.scope()` → `.set()` → `.emit()`) works for full request-lifecycle events. But quick structured logs (`log.info({ ... })`) are equally first-class. The same library handles both without mode-switching.

### 3. Zero Dependencies

No runtime dependencies. Use platform APIs (console, WritableStream, AsyncLocalStorage). Conditional exports for runtime-specific code (Node.js `util.inspect` vs Deno's `Deno.inspect` vs browser `JSON.stringify`).

### 4. Simple Sinks

A sink is `(record: LogRecord) => void`. That's it. Custom sinks are one-liners. Batching, retry, and pipeline utilities are optional composable wrappers—not baked into the core.

### 5. Hierarchical Categories

Loggers have categories (arrays of strings) that form a tree. Messages bubble up from child to parent. Sinks can be configured per category, with inheritance from parents.

## Tech Stack

### Philosophy: Zero Dependencies

This project uses **no runtime dependencies**. Everything is built with platform APIs:

- `console` for output
- `WritableStream` for stream sinks
- `AsyncLocalStorage` for implicit context (when available)
- `Date.now()` / `performance.now()` for timestamps
- No test frameworks—use `node:test`
- No color libraries—use ANSI escape codes

### Build & Tooling

- **Package Manager**: pnpm (monorepo with workspaces)
- **Build**: tsdown (ESM + CJS dual output, tree-shakeable)
- **Language**: TypeScript (strict mode)
- **Testing**: `node:test` + `node:assert`
- **Linting**: ESLint + Prettier
- **Node.js**: >= 24

### Forbidden Patterns

- No test frameworks (Jest, Vitest, Mocha)—use `node:test`
- No color libraries (chalk, colors)—use ANSI codes directly
- No CLI frameworks—this is a library, not a CLI
- No runtime dependencies whatsoever

## API Design

### Configuration (App Developers Only)

```typescript
import { configure, getConsoleSink } from 'logscope'

await configure({
  sinks: {
    console: getConsoleSink(),
  },
  loggers: [
    { category: 'my-app', level: 'debug', sinks: ['console'] },
    { category: ['my-app', 'db'], level: 'warn', sinks: ['console'] },
  ],
})
```

### Logger Usage (Library Authors + App Developers)

```typescript
import { createLogger } from 'logscope'

const log = createLogger('my-app')

// Quick structured logs
log.info({ action: 'page_view', path: '/home' })
log.info('user logged in', { userId: '123' })
log.warn('slow query', { duration: 1200, table: 'users' })
log.error('payment failed', { orderId: 'abc' })

// Child loggers (hierarchical categories)
const dbLog = log.child('db')  // category: ['my-app', 'db']
dbLog.info('query executed', { table: 'users', ms: 42 })

// Scoped wide events
const scope = log.scope({ method: 'POST', path: '/checkout' })
scope.set({ user: { id: '123', plan: 'premium' } })
scope.set({ cart: { items: 3, total: 99.99 } })
scope.set({ payment: { method: 'card' } })
scope.emit() // one structured event with all context + duration

// Context (reusable properties)
const reqLog = log.with({ requestId: 'req_abc' })
reqLog.info('processing started')  // requestId attached automatically
```

### Log Levels

Six levels in order of severity: `trace`, `debug`, `info`, `warning`, `error`, `fatal`.

### Sink Interface

```typescript
type Sink = (record: LogRecord) => void
```

### LogRecord Interface

```typescript
interface LogRecord {
  category: readonly string[]
  level: LogLevel
  timestamp: number
  message?: string
  properties: Record<string, unknown>
}
```

## Reference Implementations

When implementing features, reference these local repos for patterns and inspiration:

- **evlog** (`~/oss/evlog`): Wide events, scoped logging, pretty printing, sampling
  - Core logger: `packages/evlog/src/logger.ts`
  - Error handling: `packages/evlog/src/error.ts`
  - Browser drain: `packages/evlog/src/browser.ts`
  - Pipeline: `packages/evlog/src/pipeline.ts`

- **logtape** (`~/oss/logtape`): Library-first, hierarchical categories, sinks, filters
  - Logger implementation: `packages/logtape/src/logger.ts`
  - Sink system: `packages/logtape/src/sink.ts`
  - Config system: `packages/logtape/src/config.ts`
  - Filter system: `packages/logtape/src/filter.ts`
  - Formatter system: `packages/logtape/src/formatter.ts`
  - Context system: `packages/logtape/src/context.ts`

## Testing Strategy

- **Unit tests**: Each module tested in isolation (`level.test.ts`, `filter.test.ts`, etc.)
- **Integration tests**: Configuration → logging → sink output end-to-end
- **Library consumer tests**: Simulate using logscope as a dependency (unconfigured behavior)
- **Cross-runtime tests**: Verify behavior on Node.js (primary), with design for Deno/Bun/browser compatibility

### Testing with Node Built-ins

```typescript
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'

describe('createLogger', () => {
  it('should produce no output when unconfigured', () => {
    const log = createLogger('test')
    // This should not throw or produce any output
    log.info('silent message')
  })
})
```

## Development Commands

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Type check
pnpm typecheck

# Lint & format
pnpm lint
pnpm format
```

## Code Patterns

### Error Handling in Sinks

When a sink throws, the error should be caught and not propagate to the caller. Log the error to a meta logger (like logtape does) or swallow it. Never let a logging failure crash the application.

### Weak References for Child Loggers

Use `WeakRef` for child logger references (like logtape) to prevent memory leaks in long-running processes that create many loggers.

### Conditional Exports for Runtime-Specific Code

Use package.json `imports` with conditions for Node/Deno/browser-specific implementations:

```json
{
  "#util": {
    "node": "./dist/util.node.js",
    "deno": "./dist/util.deno.js",
    "browser": "./dist/util.browser.js",
    "default": "./dist/util.js"
  }
}
```

## Quality Checklist

Before merging any feature:

- [ ] Build succeeds (`pnpm build`)
- [ ] Tests pass (`pnpm test`)
- [ ] Linting passes (`pnpm lint`)
- [ ] Types check (`pnpm typecheck`)
- [ ] Zero runtime dependencies
- [ ] Library-first: unconfigured = silent
- [ ] Documentation updated if needed
