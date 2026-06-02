import { TelegramLogger, LogLevel } from './index.js';
import * as dotenv from 'dotenv';

dotenv.config();

const botToken = process.env.TELEGRAM_BOT_TOKEN || 'mock_token';
const chatId = process.env.TELEGRAM_CHAT_ID || 'mock_chat_id';

console.log('--- Testing Log Level Filtering (minLevel: ERROR) ---');
const errorOnlyLogger = new TelegramLogger({
  botToken,
  chatId,
  appName: 'TestApp',
  minLevel: LogLevel.ERROR
});

// These should NOT send messages if using real credentials
await errorOnlyLogger.info('This info should be ignored');
await errorOnlyLogger.warn('This warning should be ignored');
// This SHOULD send
await errorOnlyLogger.error(new Error('This error should be SENT'));

console.log('--- Testing Spam Protection ---');
const logger = new TelegramLogger({
  botToken,
  chatId,
  appName: 'TestApp',
});

await logger.error('Spam test');
await logger.error('Spam test'); // Should be ignored (duplicate within 5s)
