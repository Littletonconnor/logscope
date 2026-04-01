# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-04-01

### Added

- **Logger core**: `createLogger()` with hierarchical categories, `.child()`, `.with()` context
- **Log levels**: `trace`, `debug`, `info`, `warning`, `error`, `fatal` with `compareLogLevel()`, `parseLogLevel()`, `isLogLevel()`
- **Structured logging**: string + properties, properties-only, and tagged template overloads
- **Scoped wide events**: `log.scope()` with `.set()` deep-merge accumulation and single `.emit()`
- **Sinks**: `getConsoleSink()`, `withFilter()`, and custom `(record: LogRecord) => void` sinks
- **Filters**: `getLevelFilter()`, `toFilter()`, and custom `(record: LogRecord) => boolean` filters
- **Formatters**: `getTextFormatter()`, `getJsonFormatter()`, `getAnsiColorFormatter()`
- **Configuration**: type-safe `configure()` with generic sink/filter ID inference, `reset()`, `dispose()`
- **Context system**: explicit `.with()` context, implicit `withContext()` via `AsyncLocalStorage`
- **Cross-runtime utilities**: `inspect()` implementations for Node.js, Deno, and browsers
- **Library-first design**: zero output, zero errors, zero side effects when unconfigured
- **Zero dependencies**: no runtime dependencies, built entirely on platform APIs
- **Dual output**: ESM and CJS via tsdown, tree-shakeable with `sideEffects: false`
