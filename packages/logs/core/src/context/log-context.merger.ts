import type { LogContext, LogLevel } from '../contracts/index.js';
import { RedactionEngine } from '../redaction/redaction-engine.js';

export const LOG_CONTEXT_KEYS = [
  'context',
  'traceId',
  'spanId',
  'requestId',
  'correlationId',
] as const;

export interface ParsedLoggerArgs {
  readonly message: string;
  readonly context?: LogContext;
  readonly error?: unknown;
}

export class LogContextMerger {
  normalize(value: LogContext | string | undefined): LogContext | undefined {
    if (typeof value === 'string') return { context: value };
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value;
    return undefined;
  }

  merge(...sources: readonly (LogContext | undefined)[]): LogContext {
    const merged: Record<string, unknown> = {};
    let hasMetadata = false;
    for (const source of sources) {
      if (source === undefined) continue;
      for (const key of LOG_CONTEXT_KEYS) {
        const value = source[key];
        if (value !== undefined) merged[key] = value;
      }
      if (source.metadata !== undefined) hasMetadata = true;
    }
    if (hasMetadata) {
      const metadata: Record<string, unknown> = {};
      for (const source of sources) {
        if (source?.metadata !== undefined) Object.assign(metadata, source.metadata);
      }
      merged['metadata'] = metadata;
    }
    return merged;
  }

  parseLoggerServiceArgs(level: LogLevel, args: readonly unknown[]): ParsedLoggerArgs {
    const first = args[0];
    const message = RedactionEngine.safeString(first);
    let error: unknown = first instanceof Error ? first : undefined;
    const contextLayers: LogContext[] = [];
    const trailingStrings: string[] = [];

    for (const arg of args.slice(1)) {
      if (arg instanceof Error) {
        error ??= arg;
      } else if (typeof arg === 'string') {
        trailingStrings.push(arg);
      } else if (typeof arg === 'object' && arg !== null && !Array.isArray(arg)) {
        const layer = arg as LogContext;
        contextLayers.push(layer);
        error ??= this.extractMetadataError(layer);
      }
    }

    this.applyTrailingStrings(level, message, trailingStrings, contextLayers, (stack) => {
      if (error === undefined) error = { name: 'Error', message, stack };
    });

    const context = contextLayers.length > 0 ? this.merge(...contextLayers) : undefined;
    return {
      message,
      ...(context !== undefined ? { context } : {}),
      ...(error !== undefined ? { error } : {}),
    };
  }

  private applyTrailingStrings(
    level: LogLevel,
    _message: string,
    trailingStrings: readonly string[],
    contextLayers: LogContext[],
    onStack: (stack: string) => void,
  ): void {
    const first = trailingStrings[0];
    if (first === undefined) return;

    if (level !== 'error' && level !== 'fatal') {
      if (first !== '') contextLayers.push({ context: first });
      return;
    }

    const second = trailingStrings[1];
    if (trailingStrings.length >= 2) {
      if (first !== '') onStack(first);
      if (second !== undefined && second !== '') contextLayers.push({ context: second });
      return;
    }

    if (first !== '') {
      if (looksLikeStack(first)) onStack(first);
      else contextLayers.push({ context: first });
    }
  }

  private extractMetadataError(context: LogContext): unknown {
    const metadata = context.metadata;
    if (metadata === undefined) return undefined;
    const candidate = metadata['error'] ?? metadata['err'] ?? metadata['exception'];
    if (candidate instanceof Error) return candidate;
    if (typeof candidate === 'object' && candidate !== null && 'message' in candidate)
      return candidate;
    return undefined;
  }
}

function looksLikeStack(value: string): boolean {
  return value.includes('\n') || /^Error\b|^\s*at\s/m.test(value);
}

const DEFAULT_CONTEXT_MERGER = new LogContextMerger();

export function normalizeLogContext(
  value: LogContext | string | undefined,
): LogContext | undefined {
  return DEFAULT_CONTEXT_MERGER.normalize(value);
}

export function mergeContexts(...sources: readonly (LogContext | undefined)[]): LogContext {
  return DEFAULT_CONTEXT_MERGER.merge(...sources);
}

export function parseLoggerServiceArgs(
  level: LogLevel,
  args: readonly unknown[],
): ParsedLoggerArgs {
  return DEFAULT_CONTEXT_MERGER.parseLoggerServiceArgs(level, args);
}
