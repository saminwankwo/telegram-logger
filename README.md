# Telegram Error Logger SDK

A production-grade, **zero-dependency** NPM package that captures, enriches, and sends application errors and server events to Telegram.

## Features

- 🚀 **Zero Dependencies**: Uses native `fetch` (Node 18+). No bloat.
- ✅ **Automatic Monitoring**: Catches `uncaughtException` and `unhandledRejection`.
- 📊 **Resource Monitoring**: Tracks CPU usage, Heap memory, and Event-loop lag.
- 🔗 **Request Context**: Ties errors to HTTP requests using `AsyncLocalStorage`.
- 🔍 **Log Level Filtering**: Filter logs by `DEBUG`, `INFO`, `WARN`, `ERROR`, or `CRITICAL`.
- 🛡️ **Spam Protection**: Advanced 5-minute deduplication window for identical errors.
- ✂️ **Message Splitting**: Automatically splits logs > 4096 chars to stay within Telegram limits.
- 🔒 **Sanitization**: Automatically redacts sensitive keys (passwords, tokens, etc.) from metadata.

## Installation

```bash
npm install telegram-error-logger
```

## Usage

### Basic Setup

```typescript
import { TelegramLogger, LogLevel } from 'telegram-error-logger';

const logger = new TelegramLogger({
  botToken: 'YOUR_BOT_TOKEN',
  chatId: 'YOUR_CHAT_ID',
  appName: 'MyService',
  minLevel: LogLevel.WARN // Default: WARN
});

// Deployment notification (useful at end of bootstrap/main.ts)
await logger.notifyStartup();

// Manual logging with context
logger.info('System started');
logger.error(new Error('Database connection failed'), { 
  dbHost: 'localhost',
  userId: 'user_123',
  type: 'connection_error'
});
```

### Express Middleware Usage

```typescript
import express from 'express';
const app = express();

app.use(logger.middleware());

app.get('/', (req, res) => {
  // Logs inside this route will automatically include requestId, method, and url
  logger.info('Handling request');
  res.send('Hello World');
});
```

## Configuration Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `botToken` | `string` | - | Telegram Bot Token from @BotFather |
| `chatId` | `string` | - | Target Chat or Channel ID |
| `appName` | `string` | - | Name of your application |
| `minLevel` | `LogLevel` | `LogLevel.WARN` | Minimum level to send to Telegram |
| `enabled` | `boolean` | `true` (if prod) | Set to `false` to disable Telegram alerts |
| `resourceMonitoringInterval` | `number` | `60000` | ms between resource checks (0 to disable) |
| `eventLoopLagThreshold` | `number` | `100` | ms threshold for event-loop lag alerts |

## Environment Variables

The logger automatically respects the following environment variables if `dotenv` is configured:
- `NODE_ENV`: Sets default `enabled` and `environment` name.
- `TELEGRAM_BOT_TOKEN`: Alternative to passing in constructor.
- `TELEGRAM_CHAT_ID`: Alternative to passing in constructor.
- `APP_NAME`: Alternative to passing in constructor.

---
License: ISC | Author: Samuel Nwankwo
