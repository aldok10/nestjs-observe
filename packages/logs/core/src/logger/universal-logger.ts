import { LogContextMerger } from '../context/log-context.merger.js';
import {
  levelIndex,
  normalizeLogLevel,
  type LogContext,
  type LogContextProvider,
  type LogLevel,
  type LogRecord,
  type UniversalLogger,
} from '../contracts/index.js';
import type { LogPipeline } from '../pipeline/log-pipeline.js';
import { LogRecordFactory } from '../record/log-record.factory.js';

export type LogSink = (record: LogRecord) => void | Promise<void>;

export interface UniversalLoggerOptions {
  readonly pipeline?: LogPipeline | undefined;
  readonly context?: LogContextProvider | undefined;
  readonly level?: LogLevel | undefined;
  readonly sink?: LogSink | undefined;
  readonly baseContext?: LogContext | undefined;
}

export class UniversalLoggerImpl implements UniversalLogger {
  private readonly options: UniversalLoggerOptions;
  private readonly contextMerger = new LogContextMerger();
  private readonly recordFactory = new LogRecordFactory();
  private baseContext: LogContext;
  private thresholdIndex: number;
  private enabledOverride: ReadonlySet<LogLevel> | undefined;

  constructor(options: UniversalLoggerOptions) {
    this.options = options;
    this.baseContext = options.baseContext ?? {};
    this.thresholdIndex =
      options.level === undefined ? 0 : levelIndex(normalizeLogLevel(options.level));
  }

  trace(message: unknown, ...optionalParams: unknown[]): void {
    this.write('trace', [message, ...optionalParams]);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', [message, ...optionalParams]);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write('verbose', [message, ...optionalParams]);
  }

  info(message: unknown, ...optionalParams: unknown[]): void {
    this.write('info', [message, ...optionalParams]);
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write('log', [message, ...optionalParams]);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write('warn', [message, ...optionalParams]);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.write('error', [message, ...optionalParams]);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.write('fatal', [message, ...optionalParams]);
  }

  setLogLevels(levels: readonly string[]): void {
    this.enabledOverride = new Set(levels.map((level) => normalizeLogLevel(level)));
  }

  child(context: LogContext | string): UniversalLoggerImpl {
    const child = new UniversalLoggerImpl(this.options);
    child.baseContext = this.contextMerger.merge(
      this.baseContext,
      this.contextMerger.normalize(context),
    );
    child.thresholdIndex = this.thresholdIndex;
    child.enabledOverride = this.enabledOverride;
    return child;
  }

  withContext(context: LogContext | string): UniversalLoggerImpl {
    return this.child(context);
  }

  async flush(): Promise<void> {
    await this.options.pipeline?.flush();
  }

  async close(): Promise<void> {
    await this.options.pipeline?.close();
  }

  private write(level: LogLevel, args: readonly unknown[]): void {
    if (!this.isEnabled(level)) return;
    const parsed = this.contextMerger.parseLoggerServiceArgs(level, args);
    let ambient: LogContext | undefined;
    try {
      ambient = this.options.context?.getContext();
    } catch {
      // A broken custom provider must not stop the canonical pipeline.
    }
    const context = this.contextMerger.merge(ambient, this.baseContext, parsed.context);
    const record = this.recordFactory.create({
      level,
      message: parsed.message,
      context,
      ...(parsed.error !== undefined ? { error: parsed.error } : {}),
    });
    if (this.options.sink !== undefined) {
      try {
        const result = this.options.sink(record);
        if (result instanceof Promise) void result.catch(() => {});
      } catch {
        // A failing test/observer sink must not change logging behavior.
      }
    }
    if (this.options.pipeline !== undefined) {
      void this.options.pipeline.emit(record);
    }
  }

  private isEnabled(level: LogLevel): boolean {
    if (this.enabledOverride !== undefined) return this.enabledOverride.has(level);
    return levelIndex(level) >= this.thresholdIndex;
  }
}
