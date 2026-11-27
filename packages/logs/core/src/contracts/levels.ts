import type { LogLevel } from './index.js';

export const LOG_LEVELS = [
  'trace',
  'debug',
  'verbose',
  'info',
  'log',
  'warn',
  'error',
  'fatal',
] as const;

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value);
}

export function normalizeLogLevel(value: unknown, fallback: LogLevel = 'log'): LogLevel {
  return isLogLevel(value) ? value : fallback;
}

export function levelIndex(level: LogLevel): number {
  return LOG_LEVELS.indexOf(level);
}
