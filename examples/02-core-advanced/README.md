# 02 — Core Advanced

Advanced logscope features in a single Node.js script — sampling, fingersCrossed buffering, pipelines, implicit context, and pretty formatting.

## What it demonstrates

- **Sampling filter** — `createSamplingFilter()` with head sampling (50% of debug logs) and tail sampling (force-keep errors and slow requests)
- **fingersCrossed sink (global)** — buffer debug/info logs silently, flush all when an error arrives
- **fingersCrossed (category isolation)** — `categoryIsolation()` so one category's error doesn't flush another's buffer; `descendants` mode flushes child categories too
- **fingersCrossed (property isolation)** — `propertyIsolation('requestId')` for per-request buffering with LRU eviction
- **createPipeline** — batched async processing with configurable batch size, interval, retry, and `onDropped` callback
- **Implicit context** — `withContext({ requestId: '...' }, () => { ... })` with `AsyncLocalStorage`
- **Context priority** — message properties > explicit `.with()` > implicit `withContext()`
- **withCategoryPrefix** — `withCategoryPrefix('my-sdk', () => { ... })` for SDK category namespacing
- **Pretty formatter** — `getPrettyFormatter()` with tree-formatted wide event output using box-drawing characters
- **Auto formatter** — `getAutoFormatter()` showing dev/prod detection (pretty in dev, JSON in prod)

## How to run

```bash
# From the repository root
pnpm install
pnpm build
pnpm --filter example-core-advanced dev

# Or from this directory
pnpm dev
```

## Expected output

You should see:

1. **Sampling** — some debug messages kept, others dropped; errors always kept; slow requests force-kept
2. **fingersCrossed** — zero output until an error, then the full buffer flushes with context
3. **Category isolation** — only the erroring category's buffer flushes
4. **Property isolation** — only the erroring request's buffer flushes
5. **Pipeline** — batch flush messages showing batch sizes and timing
6. **Context** — `requestId` and `traceId` automatically attached to logs inside `withContext`
7. **Priority** — message-level properties override `.with()` and `withContext` values
8. **Category prefix** — loggers created inside `withCategoryPrefix` get prefixed categories
9. **Pretty** — tree-formatted wide event output with `├──` and `└──` box-drawing
10. **Auto** — pretty output in dev mode (same as pretty formatter)
