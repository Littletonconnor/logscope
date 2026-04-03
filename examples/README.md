# logscope examples

Each example is a standalone project that demonstrates a different aspect of logscope. All examples use `workspace:*` linking, so run `pnpm install && pnpm build` from the repo root before trying them.

| Example | What it demonstrates | Port | Run command |
| --- | --- | --- | --- |
| [01-core-basics](./01-core-basics) | Console/JSON sinks, child loggers, context, scoped wide events | N/A | `pnpm --filter example-core-basics dev` |
| [02-core-advanced](./02-core-advanced) | Sampling, fingersCrossed buffering, pipelines, implicit context, pretty formatting | N/A | `pnpm --filter example-core-advanced dev` |
| [03-hono](./03-hono) | Request-scoped wide event logging via `@logscope/hono` middleware | 3001 | `pnpm --filter example-hono dev` |
| [04-express](./04-express) | Request-scoped wide event logging via `@logscope/express` middleware | 3002 | `pnpm --filter example-express dev` |
| [05-next](./05-next) | `withLogscope` wrapper for Next.js route handlers and server actions | 3003 | `pnpm --filter example-next dev` |
| [06-nitro](./06-nitro) | Request-scoped wide event logging via `@logscope/nitro` plugin | 3000 | `pnpm --filter example-nitro dev` |
| [07-browser](./07-browser) | Browser-optimized `createBrowserDrain` with batching and mock ingest | 3005 | `pnpm --filter example-browser dev` |
| [08-axiom](./08-axiom) | Batched export to mock Axiom Ingest API with retry and buffer overflow | 3006 | `pnpm --filter example-axiom dev` |
| [09-otlp](./09-otlp) | OTLP HTTP/JSON export with resource attributes and mock collector | 3007 | `pnpm --filter example-otlp dev` |
| [10-sentry](./10-sentry) | Error-only filtering with batched export to mock Sentry envelope API | 3008 | `pnpm --filter example-sentry dev` |
