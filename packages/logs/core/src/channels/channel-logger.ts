import type { LogContextStore } from '../context/log-context-store.js';
import { LogContextMerger } from '../context/log-context.merger.js';
import type { LogContext, LogLevel, LogRecord, UniversalLogger } from '../contracts/index.js';
import { UniversalLoggerImpl } from '../logger/universal-logger.js';
import type { LogPipeline } from '../pipeline/log-pipeline.js';
import type { ChannelName } from './channel.contracts.js';
import type { ChannelRouter } from './channel-router.js';

export class ChannelLogger<N extends ChannelName = ChannelName> implements UniversalLogger {
  private readonly inner: UniversalLoggerImpl;
  private readonly baseContext: LogContext;
  private readonly contextMerger = new LogContextMerger();

  constructor(
    readonly name: N,
    private readonly router: ChannelRouter<N>,
    private readonly store: LogContextStore | undefined,
    private readonly level: LogLevel | undefined,
    private readonly pipeline?: LogPipeline,
    baseContext: LogContext = {},
  ) {
    this.baseContext = baseContext;
    this.inner = new UniversalLoggerImpl({
      ...(store !== undefined ? { context: store } : {}),
      ...(level !== undefined ? { level } : {}),
      baseContext,
      sink: (record: LogRecord) => this.route(record),
    });
  }

  trace(message: unknown, ...optionalParams: unknown[]): void {
    this.inner.trace(message, ...optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.inner.debug(message, ...optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.inner.verbose(message, ...optionalParams);
  }

  info(message: unknown, ...optionalParams: unknown[]): void {
    this.inner.info(message, ...optionalParams);
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.inner.log(message, ...optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.inner.warn(message, ...optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.inner.error(message, ...optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.inner.fatal(message, ...optionalParams);
  }

  child(context: LogContext | string): ChannelLogger<N> {
    const patch = this.contextMerger.normalize(context) ?? {};
    return new ChannelLogger(
      this.name,
      this.router,
      this.store,
      this.level,
      this.pipeline,
      this.contextMerger.merge(this.baseContext, patch),
    );
  }

  withContext(context: LogContext | string): ChannelLogger<N> {
    return this.child(context);
  }

  setLogLevels(levels: readonly string[]): void {
    this.inner.setLogLevels(levels);
  }

  async flush(): Promise<void> {
    await this.pipeline?.flush();
  }

  async close(): Promise<void> {
    await this.pipeline?.close();
  }

  private route(record: LogRecord): void {
    const context = this.contextMerger.merge(this.store?.get(), this.baseContext);
    this.router.route({ origin: this.name, record, context });
  }
}
