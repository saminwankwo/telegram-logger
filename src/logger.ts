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
  enabled?: boolean;
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
  private options: LoggerOptions;
  private crashCount: number = 0;
  private recentAlerts = new Map<string, number>();
  private lastCpuUsage: { user: number; system: number } | null = null;
  private lastCpuTime: number = 0;
  private readonly DEDUP_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(options: LoggerOptions) {
    this.options = {
      environment: process.env.NODE_ENV || 'development',
      minLevel: LogLevel.WARN,
      enabled: options.enabled ?? (process.env.NODE_ENV === 'production' || !!options.botToken),
      resourceMonitoringInterval: 60_000,
      eventLoopLagThreshold: 100,
      ...options,
    };
    this.setupAutoMonitoring();
    this.startMonitoring();
    this.setupCleanup();
  }

  /**
   * Send a deployment notification
   */
  async notifyStartup(): Promise<void> {
    await this.info('Server started', {
      version: process.env.APP_VERSION ?? this.options.version ?? 'unknown',
      commit: process.env.GIT_COMMIT ?? 'unknown',
      branch: process.env.GIT_BRANCH ?? 'unknown',
      nodeVersion: process.version,
      uptime: `${process.uptime().toFixed(1)}s`,
      pid: process.pid,
      type: 'startup_notification',
    });
  }

  private setupCleanup() {
    setInterval(() => {
      const cutoff = Date.now() - this.DEDUP_TTL;
      for (const [key, ts] of this.recentAlerts) {
        if (ts < cutoff) this.recentAlerts.delete(key);
      }
    }, 10 * 60 * 1000).unref();
  }

  private startMonitoring() {
    if (this.options.enabled && this.options.resourceMonitoringInterval && this.options.resourceMonitoringInterval > 0) {
      setInterval(() => {
        this.logResources();
      }, this.options.resourceMonitoringInterval).unref();
    }

    this.monitorEventLoopLag();
  }

  private monitorEventLoopLag() {
    if (!this.options.enabled) return;
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
    return this.options.enabled === true && level >= (this.options.minLevel ?? LogLevel.WARN);
  }

  private isSpam(message: string | Error): boolean {
    const key = message instanceof Error ? `${message.message}${message.stack ?? ''}` : message;
    const hash = crypto.createHash('md5').update(key).digest('hex');
    const now = Date.now();
    const lastSeen = this.recentAlerts.get(hash);

    if (lastSeen && now - lastSeen < this.DEDUP_TTL) {
      return true;
    }

    this.recentAlerts.set(hash, now);
    return false;
  }

  private splitMessage(text: string, limit = 4000): string[] {
    if (text.length <= limit) return [text];
    const parts: string[] = [];
    let i = 0;
    while (i < text.length) {
      parts.push(text.slice(i, i + limit));
      i += limit;
    }
    return parts;
  }

  private async sendMessage(text: string, level: LogLevel, originalMessage: string | Error) {
    if (!this.shouldLog(level)) return;
    if (this.isSpam(originalMessage)) return;

    const chunks = this.splitMessage(text);

    for (let i = 0; i < chunks.length; i++) {
      const suffix = chunks.length > 1 ? `\n\n_(${i + 1}/${chunks.length})_` : '';
      await this.postToTelegram(chunks[i] + suffix);
    }
  }

  private async postToTelegram(text: string) {
    try {
      const url = `https://api.telegram.org/bot${this.options.botToken}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.options.chatId,
          text,
          parse_mode: 'Markdown',
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Telegram API Error:', response.status, errorData);
      }
    } catch (error) {
      console.error('Failed to send message to Telegram via fetch:', error);
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
    await this.sendMessage(text, LogLevel.INFO, message);
  }

  async warn(message: string, context?: any) {
    const text = this.formatMessage('WARNING', message, '⚠️', context);
    await this.sendMessage(text, LogLevel.WARN, message);
  }

  async error(error: Error | string, context?: any) {
    const err = error instanceof Error ? error : new Error(error);
    const text = this.formatMessage('ERROR', err, '🚨', context);
    await this.sendMessage(text, LogLevel.ERROR, err);
  }

  async critical(error: Error | string, context?: any) {
    const err = error instanceof Error ? error : new Error(error);
    const text = this.formatMessage('CRITICAL', err, '🔥', context);
    await this.sendMessage(text, LogLevel.CRITICAL, err);
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
