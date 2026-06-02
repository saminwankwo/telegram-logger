# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-06-02

### Added
- **Zero-Dependency Core**: Uses native `fetch` (Node 18+), removing heavy dependencies like `node-telegram-bot-api` and `axios`.
- **Async Context Support**: Integrated `AsyncLocalStorage` to automatically track and propagate `requestId`, `method`, and `url` across asynchronous hops.
- **Advanced Monitoring**:
  - Real-time CPU usage percentage calculation.
  - Memory heap monitoring with OOM protection alerts.
  - Event-loop lag detection to identify synchronous bottlenecks.
- **Smart Deduplication**: `Map`-based deduplication system with a **5-minute TTL** and MD5 hashing of error messages/stacks to prevent alert storms.
- **Message Splitting**: Automatic message splitting for Telegram's 4096-character limit with `(1/3)` style suffixes.
- **Lifecycle Management**:
  - `notifyStartup()`: Deployment heartbeat with version, commit, and uptime context.
  - Graceful shutdown notifications for `SIGINT` and `SIGTERM`.
- **Developer Experience**:
  - `minLevel` filtering (defaults to `WARN`).
  - `enabled` flag (defaults to `true` in production).
  - Built-in sanitization for sensitive keys (passwords, tokens, etc.).
  - Proper CJS/ESM exports and TypeScript definitions.
