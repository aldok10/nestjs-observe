import { AsyncLocalStorage } from 'node:async_hooks';
import type { LogContext, LogContextProvider } from '../contracts/index.js';
import { LOG_CONTEXT_KEYS } from './log-context.merger.js';

type StoredContext = { [K in keyof LogContext]?: LogContext[K] | undefined };

const KEYS = [...LOG_CONTEXT_KEYS, 'metadata'] as const;

export interface LogContextStoreOptions {
  /** Supplies trace/span fields from an external tracer. Core never loads an SDK. */
  readonly activeSpanProvider?: () => LogContext;
}

export class LogContextStore implements LogContextProvider {
  private readonly storage = new AsyncLocalStorage<StoredContext>();
  private readonly activeSpanProvider: (() => LogContext) | undefined;

  constructor(options: LogContextStoreOptions = {}) {
    this.activeSpanProvider = options.activeSpanProvider;
  }

  run<T>(context: LogContext, fn: () => T): T {
    return this.storage.run(this.cloneContext(context), fn);
  }

  get(): LogContext {
    return this.toLogContext(this.storage.getStore() ?? {});
  }

  /** LogContextProvider contract; no second store is introduced. */
  getContext(): LogContext {
    return this.get();
  }

  runWithContext<T>(context: LogContext, fn: () => T): T {
    return this.run(context, fn);
  }

  set(patch: LogContext): void {
    const current = this.storage.getStore();
    if (current === undefined) {
      this.storage.enterWith(this.cloneContext(patch));
      return;
    }
    for (const key of KEYS) {
      const value = patch[key];
      if (value !== undefined) (current as Record<string, unknown>)[key] = value;
    }
  }

  /** Returns trace correlation from the configured provider, or {} when none is set. */
  fromActiveSpan(): LogContext {
    if (this.activeSpanProvider === undefined) return {};
    try {
      return this.toLogContext(this.cloneContext(this.activeSpanProvider()));
    } catch {
      return {};
    }
  }

  private cloneContext(context: LogContext): StoredContext {
    const result: StoredContext = {};
    for (const key of KEYS) {
      const value = context[key];
      if (value !== undefined) (result as Record<string, unknown>)[key] = value;
    }
    return result;
  }

  private toLogContext(stored: StoredContext): LogContext {
    return {
      ...(stored.context !== undefined ? { context: stored.context } : {}),
      ...(stored.requestId !== undefined ? { requestId: stored.requestId } : {}),
      ...(stored.correlationId !== undefined ? { correlationId: stored.correlationId } : {}),
      ...(stored.traceId !== undefined ? { traceId: stored.traceId } : {}),
      ...(stored.spanId !== undefined ? { spanId: stored.spanId } : {}),
      ...(stored.metadata !== undefined ? { metadata: stored.metadata } : {}),
    };
  }
}
