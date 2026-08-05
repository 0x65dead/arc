import { config } from './config.js';

/**
 * Minimal structured logger.
 *
 * The previous code used bare `console.log` with ad-hoc `[prefix]` strings and
 * no levels, so there was no way to quiet a chatty backfill in production or
 * to turn on detail while debugging one. Output stays human-readable; set
 * LOG_FORMAT=json for a machine-parsable stream.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

const threshold = LEVELS[config.logLevel] ?? LEVELS.info;
const asJson = process.env.LOG_FORMAT?.trim().toLowerCase() === 'json';

function emit(level: Level, scope: string, message: string, fields?: Record<string, unknown>): void {
  if (LEVELS[level] < threshold) return;

  const timestamp = new Date().toISOString();

  if (asJson) {
    const line = JSON.stringify({ ts: timestamp, level, scope, msg: message, ...fields });
    (level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);
    return;
  }

  const suffix = fields && Object.keys(fields).length > 0 ? ` ${formatFields(fields)}` : '';
  const line = `${timestamp} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}${suffix}`;
  (level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);
}

function formatFields(fields: Record<string, unknown>): string {
  return Object.entries(fields)
    .map(([key, value]) => {
      if (value instanceof Error) return `${key}=${value.message}`;
      if (typeof value === 'object' && value !== null) return `${key}=${JSON.stringify(value)}`;
      return `${key}=${String(value)}`;
    })
    .join(' ');
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export function createLogger(scope: string): Logger {
  return {
    debug: (message, fields) => emit('debug', scope, message, fields),
    info: (message, fields) => emit('info', scope, message, fields),
    warn: (message, fields) => emit('warn', scope, message, fields),
    error: (message, fields) => emit('error', scope, message, fields),
  };
}
