# Telegram Error Logger SDK

A production-grade NPM package that captures, enriches, and sends application errors and server events to Telegram.

## Features

- ✅ **Automatic Monitoring**: Catches `uncaughtException` and `unhandledRejection`.
- ✅ **Resource Monitoring**: Tracks CPU usage, Heap memory, and Event-loop lag.
- ✅ **Request Context**: Ties errors to HTTP requests using `AsyncLocalStorage`.
- ✅ **Log Levels**: Filter logs by `DEBUG`, `INFO`, `WARN`, `ERROR`, or `CRITICAL`.
- ✅ **Spam Protection**: Prevents Telegram API rate limiting with message throttling.
- ✅ **Sanitization**: Automatically redacts sensitive keys from metadata.

## Installation

```bash
npm install telegram-error-logger
```

## Usage

```typescript
import { TelegramLogger, LogLevel } from 'telegram-error-logger';

const logger = new TelegramLogger({
  botToken: 'YOUR_BOT_TOKEN',
  chatId: 'YOUR_CHAT_ID',
  appName: 'MyService',
  minLevel: LogLevel.ERROR // Only send errors and critical alerts to Telegram
});

// Manual logging
logger.info('System started');
logger.error(new Error('Database connection failed'));

// Express Middleware
app.use(logger.middleware());
```

## Configuration Options

| Option | Type | Description |
| --- | --- | --- |
| `botToken` | `string` | Telegram Bot Token from @BotFather |
| `chatId` | `string` | Target Chat or Channel ID |
| `appName` | `string` | Name of your application |
| `minLevel` | `LogLevel` | Minimum level to send to Telegram (default: INFO) |
| `resourceMonitoringInterval` | `number` | ms between resource checks (default: 60000, 0 to disable) |
| `eventLoopLagThreshold` | `number` | ms threshold for event-loop lag alerts (default: 100) |
