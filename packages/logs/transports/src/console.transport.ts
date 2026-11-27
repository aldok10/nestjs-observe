import type { Writable } from 'node:stream';
import type {
  FormatterType,
  LogFormatter,
  LogLevel,
  LogRecord,
  LogTransport,
} from '@aldok10/nestjs-observe-logger-core/contracts';
import { resolveFormatter } from '@aldok10/nestjs-observe-logger-core/formatters';
import { textFormatter } from '@aldok10/nestjs-observe-logger-formatters/text';

export interface ConsoleTransportOptions {
  readonly formatter?: FormatterType | LogFormatter;
  readonly stdout?: Writable;
  readonly stderr?: Writable;
  readonly color?: boolean;
  readonly onError?: (error: unknown) => void;
}

const ERROR_LEVELS = new Set<LogLevel>(['warn', 'error', 'fatal']);
const COLORS: Partial<Record<LogLevel, string>> = {
  warn: '\x1b[33m',
  error: '\x1b[31m',
  fatal: '\x1b[35m',
  info: '\x1b[32m',
  log: '\x1b[32m',
  debug: '\x1b[36m',
  trace: '\x1b[90m',
  verbose: '\x1b[90m',
};

export class ConsoleTransport implements LogTransport {
  readonly name = 'console';
  private readonly formatter: LogFormatter;
  private readonly stdout: Writable;
  private readonly stderr: Writable;
  private readonly color: boolean;
  private readonly onError?: (error: unknown) => void;
  private readonly onStdoutError: (error: Error) => void;
  private readonly onStderrError: (error: Error) => void;
  private writes: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(options: ConsoleTransportOptions = {}) {
    this.formatter =
      options.formatter === undefined ? textFormatter : resolveFormatter(options.formatter);
    this.stdout = options.stdout ?? process.stdout;
    this.stderr = options.stderr ?? process.stderr;
    this.color = options.color ?? false;
    if (options.onError) this.onError = options.onError;
    this.onStdoutError = (error: Error): void => this.report(error);
    this.onStderrError = (error: Error): void => this.report(error);
    this.stdout.on('error', this.onStdoutError);
    this.stderr.on('error', this.onStderrError);
  }

  write(record: LogRecord): Promise<void> | void {
    if (this.closed) return;
    try {
      const formatted = this.formatter.format(record);
      let line = typeof formatted === 'string' ? formatted : formatted.toString('utf8');
      if (this.color && !line.includes('\x1b[')) {
        const color = COLORS[record.level];
        if (color) line = `${color}${line}\x1b[0m`;
      }
      const stream = ERROR_LEVELS.has(record.level) ? this.stderr : this.stdout;
      const result = writeToStream(stream, `${line}\n`, (error) => this.report(error));
      if (result !== undefined) {
        this.writes = this.writes.then(() => result).catch(() => undefined);
        return this.writes;
      }
    } catch (error: unknown) {
      this.report(error);
    }
  }

  async flush(): Promise<void> {
    await this.writes.catch(() => undefined);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.flush();
    this.stdout.off('error', this.onStdoutError);
    this.stderr.off('error', this.onStderrError);
  }

  private report(error: unknown): void {
    if (!this.onError) return;
    try {
      this.onError(error);
    } catch {
      // onError is diagnostic only; a broken handler must not break logging.
    }
  }
}

function writeToStream(
  stream: Writable,
  chunk: string,
  onError: (error: unknown) => void,
): Promise<void> | undefined {
  try {
    let ok = true;
    let callbackFired = false;
    ok = stream.write(chunk, (error) => {
      callbackFired = true;
      if (error) onError(error);
    });
    if (ok) return undefined;
    if (callbackFired) return undefined;
    return new Promise((resolve) => {
      const cleanup = (): void => {
        stream.off('drain', onDrain);
        stream.off('error', onErrorEvent);
      };
      const onDrain = (): void => {
        cleanup();
        resolve();
      };
      const onErrorEvent = (error: unknown): void => {
        cleanup();
        onError(error);
        resolve();
      };
      stream.on('drain', onDrain);
      stream.on('error', onErrorEvent);
    });
  } catch (error) {
    onError(error);
    return undefined;
  }
}
