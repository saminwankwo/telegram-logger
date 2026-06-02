import TelegramBot from 'node-telegram-bot-api';
import os from 'os';
import crypto from 'crypto';
import * as dotenv from 'dotenv';
import { AsyncLocalStorage } from 'async_hooks';

dotenv.config();

const SENSITIVE_KEYS = new Set(['password', 'token', 'secret', 'authorization', 'cvv', 'pin', 'key', 'cookie']);

function sanitize(obj: any, depth = 3): any {
  if (depth === 0 || !obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(item => sanitize(item, depth - 1));

  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [
      k,
      SENSITIVE_KEYS.has(k.toLowerCase()) ? '[REDACTED]'
        : v && typeof v === 'object' ? sanitize(v, depth - 1)
        : v,
    ])
  );
}

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  CRITICAL = 4,
}

export interface LoggerOptions {
  botToken: string;
  chatId: string;
  appName: string;
  environment?: string;
  version?: string;
  minLevel?: LogLevel;
  resourceMonitoringInterval?: number; // in ms, 0 to disable
  eventLoopLagThreshold?: number; // in ms, default 100
}

export interface RequestContext {
  requestId: string;
  userId?: string;
  method?: string;
  url?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export class TelegramLogger {
  private bot: TelegramBot;
  private options: LoggerOptions;
  private crashCount: number = 0;
  private lastMessageHash: string = '';
  private lastMessageTime: number = 0;
  private lastCpuUsage: { user: number; system: number } | null = null;
  private lastCpuTime: number = 0;

  constructor(options: LoggerOptions) {
    this.options = {
      environment: process.env.NODE_ENV || 'development',
      minLevel: LogLevel.INFO,
      resourceMonitoringInterval: 60_000,
      eventLoopLagThreshold: 100,
      ...options,
    };
    this.bot = new TelegramBot(this.options.botToken);
    this.setupAutoMonitoring();
    this.startMonitoring();
  }

  private startMonitoring() {
    if (this.options.resourceMonitoringInterval && this.options.resourceMonitoringInterval > 0) {
      setInterval(() => {
        this.logResources();
      }, this.options.resourceMonitoringInterval).unref();
    }

    this.monitorEventLoopLag();
  }

  private monitorEventLoopLag() {
    let last = Date.now();
    const interval = 1000;
    setInterval(() => {
      const now = Date.now();
      const lag = now - last - interval;
      last = now;

      if (lag > (this.options.eventLoopLagThreshold || 100)) {
        this.warn(`⚡ Event-loop lag detected: ${lag}ms — possible blocking operation`);
      }
    }, interval).unref();
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= (this.options.minLevel ?? LogLevel.INFO);
  }

  private isSpam(text: string): boolean {
    const hash = crypto.createHash('md5').update(text).digest('hex');
    const now = Date.now();
    const cooldown = 5000; // 5 seconds cooldown for exact same message

    if (hash === this.lastMessageHash && now - this.lastMessageTime < cooldown) {
      return true;
    }

    this.lastMessageHash = hash;
    this.lastMessageTime = now;
    return false;
  }

  private async sendMessage(text: string, level: LogLevel) {
    if (!this.shouldLog(level)) return;
    if (this.isSpam(text)) return;

    try {
      // Ensure text is not too long for Telegram (max 4096 chars)
      const truncatedText = text.length > 4000 ? text.substring(0, 3997) + '...' : text;
      await this.bot.sendMessage(this.options.chatId, truncatedText, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Failed to send message to Telegram:', error);
    }
  }

  private formatMessage(level: string, message: string | Error, emoji: string, extraContext?: any) {
    const timestamp = new Date().toISOString();
    const hostname = os.hostname();
    const { appName, environment, version } = this.options;
    const context = requestContext.getStore();

    let content = `${emoji} *${level.toUpperCase()}*\n\n`;
    content += `*App:* ${appName} | *Env:* ${environment}\n`;
    if (version) content += `*Ver:* ${version}\n`;
    content += `*Host:* ${hostname}\n`;
    
    if (context?.requestId) {
      content += `*Request ID:* \`${context.requestId}\`\n`;
    }
    if (context?.method && context?.url) {
      content += `*Route:* ${context.method} ${context.url}\n`;
    }
    
    content += `\n`;

    if (message instanceof Error) {
      content += `*Error:* ${message.name}\n`;
      content += `*Message:* ${message.message}\n\n`;
      content += `*Stack:*\n\`\`\`\n${message.stack?.split('\n').slice(0, 10).join('\n')}\n\`\`\`\n\n`;
      
      if (message.cause) {
        content += `*Cause:* ${String(message.cause)}\n\n`;
      }
    } else {
      content += `*Message:* ${message}\n\n`;
    }

    if (extraContext) {
      const sanitizedContext = sanitize(extraContext);
      content += `*Extra Context:*\n\`\`\`json\n${JSON.stringify(sanitizedContext, null, 2)}\n\`\`\`\n\n`;
    }

    if (this.crashCount > 0) {
      content += `*Session Crashes:* ${this.crashCount}\n`;
    }

    content += `*Timestamp:* ${timestamp}`;
    return content;
  }

  async info(message: string, context?: any) {
    const text = this.formatMessage('INFO', message, 'ℹ️', context);
    await this.sendMessage(text, LogLevel.INFO);
  }

  async warn(message: string, context?: any) {
    const text = this.formatMessage('WARNING', message, '⚠️', context);
    await this.sendMessage(text, LogLevel.WARN);
  }

  async error(error: Error | string, context?: any) {
    const err = error instanceof Error ? error : new Error(error);
    const text = this.formatMessage('ERROR', err, '🚨', context);
    await this.sendMessage(text, LogLevel.ERROR);
  }

  async critical(error: Error | string, context?: any) {
    const err = error instanceof Error ? error : new Error(error);
    const text = this.formatMessage('CRITICAL', err, '🔥', context);
    await this.sendMessage(text, LogLevel.CRITICAL);
  }

  private setupAutoMonitoring() {
    process.on('uncaughtException', async (err) => {
      this.crashCount++;
      await this.critical(err, { type: 'uncaughtException', fatal: true });
      process.exit(1);
    });

    process.on('unhandledRejection', async (reason) => {
      const err = reason instanceof Error ? reason : new Error(String(reason));
      await this.error(err, { type: 'unhandledRejection' });
    });

    // Graceful shutdown signals
    ['SIGINT', 'SIGTERM'].forEach(signal => {
      process.on(signal, async () => {
        await this.info(`Received ${signal}. Shutting down gracefully...`);
        // Give time for the message to be sent
        setTimeout(() => process.exit(0), 1000);
      });
    });
  }

  // Helper for resource monitoring
  async logResources() {
    const { heapUsed, heapTotal, rss } = process.memoryUsage();
    const heapPct = ((heapUsed / heapTotal) * 100).toFixed(1);
    
    // CPU calculation
    const currentCpuUsage = process.cpuUsage();
    const currentCpuTime = Date.now();
    let cpuPercent = '0.0';

    if (this.lastCpuUsage && this.lastCpuTime) {
      const userDelta = currentCpuUsage.user - this.lastCpuUsage.user;
      const systemDelta = currentCpuUsage.system - this.lastCpuUsage.system;
      const timeDelta = (currentCpuTime - this.lastCpuTime) * 1000; // to microseconds
      cpuPercent = ((userDelta + systemDelta) / timeDelta * 100).toFixed(1);
    }

    this.lastCpuUsage = currentCpuUsage;
    this.lastCpuTime = currentCpuTime;
    
    const stats = {
      memory: {
        heapUsedMB: (heapUsed / 1e6).toFixed(1),
        heapTotalMB: (heapTotal / 1e6).toFixed(1),
        heapPct: `${heapPct}%`,
        rssMB: (rss / 1e6).toFixed(1),
      },
      cpu: {
        usage: `${cpuPercent}%`,
      },
      uptime: process.uptime().toFixed(1) + 's',
    };

    if (parseFloat(heapPct) > 85) {
      await this.critical('🚨 OOM Warning: High Memory Usage', stats);
    } else if (parseFloat(cpuPercent) > 80) {
      await this.warn('⚡ High CPU Usage Detected', stats);
    }
  }

  /**
   * Middleware for Express to capture request context
   */
  middleware() {
    return (req: any, res: any, next: () => void) => {
      const context: RequestContext = {
        requestId: req.headers['x-request-id'] || crypto.randomUUID(),
        method: req.method,
        url: req.url,
      };
      requestContext.run(context, next);
    };
  }
}
