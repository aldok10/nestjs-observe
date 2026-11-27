import { levelIndex } from '@aldok10/nestjs-observe-logger-core/contracts';
import type {
  LogContext,
  LogFilter,
  LogLevel,
  LogRecord,
} from '@aldok10/nestjs-observe-logger-core/contracts';

/** Accept records at or above the given severity. */
export function levelAtLeast(minimum: LogLevel): LogFilter {
  const floor = levelIndex(minimum);
  return (record) => levelIndex(record.level) >= floor;
}

export function excludeLevels(levels: readonly LogLevel[]): LogFilter {
  const excluded = new Set<LogLevel>(levels);
  return (record) => !excluded.has(record.level);
}

/** Deterministically rejects when rate <= 0, accepts when rate >= 1. */
export function sample(rate: number): LogFilter {
  if (rate <= 0) return () => false;
  if (rate >= 1) return () => true;
  return () => Math.random() < rate;
}

export interface ChannelFilterOptions {
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
}

export function channelFilter(options: ChannelFilterOptions): LogFilter {
  const include = new Set(options.include ?? []);
  const exclude = new Set(options.exclude ?? []);
  return (record) => {
    const channel = record.channel;
    if (include.size > 0 && (channel === undefined || !include.has(channel))) return false;
    return channel === undefined || !exclude.has(channel);
  };
}

export function byContext(predicate: (context: LogContext) => boolean): LogFilter {
  return (record, context) => {
    try {
      return predicate({ ...context, ...pickRecordContext(record) });
    } catch {
      return false;
    }
  };
}

export function composeFilters(...filters: readonly LogFilter[]): LogFilter {
  return (record, context) => {
    for (const filter of filters) {
      try {
        if (!filter(record, context)) return false;
      } catch {
        return false;
      }
    }
    return true;
  };
}

function pickRecordContext(record: LogRecord): LogContext {
  return {
    ...(record.context !== undefined ? { context: record.context } : {}),
    ...(record.requestId !== undefined ? { requestId: record.requestId } : {}),
    ...(record.traceId !== undefined ? { traceId: record.traceId } : {}),
    ...(record.correlationId !== undefined ? { correlationId: record.correlationId } : {}),
  };
}
