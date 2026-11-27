import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { basename, dirname } from 'node:path';
import type { Writable } from 'node:stream';
import type { OptionsWithoutRotate, RotatingFileStream } from 'rotating-file-stream';
import type {
  FormatterType,
  LogFormatter,
  LogRecord,
  LogTransport,
} from '@aldok10/nestjs-observe-logger-core/contracts';
import { resolveFormatter } from '@aldok10/nestjs-observe-logger-core/formatters';
import { jsonFormatter } from '@aldok10/nestjs-observe-logger-formatters/json';
import { BoundedExecution } from '@aldok10/nestjs-observe-logger-core';
import { OptionalPeerLoader } from './optional-peer.loader.js';

export interface StreamRotationOptions {
  readonly size?: string | number;
  readonly interval?: string;
  readonly maxFiles?: string | number;
  readonly compress?: boolean;
  readonly dateFormat?: string;
}

export interface StreamTransportFileOptions {
  readonly path: string;
  readonly stream?: undefined;
  readonly closeStream?: undefined;
  readonly formatter?: FormatterType | LogFormatter;
  readonly rotation?: StreamRotationOptions;
  readonly mode?: number;
  readonly onError?: (error: unknown) => void;
}

export interface StreamTransportWritableOptions {
  readonly stream: Writable;
  readonly closeStream?: boolean;
  readonly path?: undefined;
  readonly rotation?: undefined;
  readonly mode?: undefined;
  readonly formatter?: FormatterType | LogFormatter;
  readonly onError?: (error: unknown) => void;
}

export type StreamTransportOptions = StreamTransportFileOptions | StreamTransportWritableOptions;

interface RotatingFileStreamModule {
  createStream(filename: string, options?: OptionsWithoutRotate): RotatingFileStream;
}

export class StreamTransport implements LogTransport {
  readonly name = 'stream';
  private readonly stream: Writable | WriteStream | RotatingFileStream;
  private readonly ownsStream: boolean;
  private readonly formatter: LogFormatter;
  private readonly onError?: (error: unknown) => void;
  private readonly peerLoader = new OptionalPeerLoader();
  private readonly boundedExecution = new BoundedExecution();
  private writes: Promise<void> = Promise.resolve();
  private closing?: Promise<void>;
  private closed = false;
  private readonly onStreamError = (error: Error): void => this.report(error);

  constructor(options: StreamTransportOptions) {
    this.formatter =
      options.formatter === undefined ? jsonFormatter : resolveFormatter(options.formatter);
    if (options.onError) this.onError = options.onError;

    if (options.stream !== undefined) {
      this.stream = options.stream;
      this.ownsStream = options.closeStream === true;
    } else {
      // Concurrent processes must not rotate the same file: use {pid} placeholders or a single writer.
      const path = options.path.replaceAll('{pid}', String(process.pid));
      const dir = dirname(path);
      mkdirSync(dir, { recursive: true });

      const rotation = options.rotation;
      if (rotation) {
        const size =
          rotation.size === undefined
            ? undefined
            : typeof rotation.size === 'number'
              ? `${rotation.size}B`
              : rotation.size;
        const rotationOptions: OptionsWithoutRotate = {
          path: dir,
          ...(size === undefined ? {} : { size }),
          ...(rotation.interval === undefined ? {} : { interval: rotation.interval }),
          ...(rotation.maxFiles === undefined ? {} : { maxFiles: Number(rotation.maxFiles) }),
          ...(rotation.compress === undefined ? {} : { compress: rotation.compress }),
          mode: options.mode ?? 0o600,
        };
        const loaded = this.peerLoader.load('rotating-file-stream', 'file rotation');
        if (typeof loaded !== 'object' || loaded === null || !('createStream' in loaded)) {
          throw new TypeError('Invalid rotating-file-stream module: missing createStream');
        }
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shape checked above
        const rfs = loaded as unknown as RotatingFileStreamModule;
        // rfs v4 replaced dateFormat with a filename generator, so dateFormat is ignored.
        this.stream = rfs.createStream(basename(path), rotationOptions);
      } else {
        this.stream = createWriteStream(path, {
          flags: 'a',
          mode: options.mode ?? 0o600,
        });
      }
      this.ownsStream = true;
    }

    // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- union event overloads require narrowing
    (this.stream as Writable).on('error', this.onStreamError);
  }

  write(record: LogRecord): Promise<void> | void {
    if (this.closed) return;
    let chunk: string | Buffer;
    try {
      const formatted = this.formatter.format(record);
      chunk =
        typeof formatted === 'string'
          ? `${formatted}\n`
          : Buffer.concat([formatted, Buffer.from('\n')]);
    } catch (error: unknown) {
      this.report(error);
      return;
    }
    const pending = this.writes.then(() => this.writeChunk(chunk));
    this.writes = pending.catch(() => undefined);
    return pending;
  }

  async flush(timeoutMs = 5000): Promise<void> {
    await this.boundedExecution.run(this.writes, timeoutMs).catch(() => undefined);
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.closing = (async () => {
      await this.flush();
      if (!this.ownsStream) {
        // External streams stay open; only our listener is removed.
        // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- union event overloads require narrowing
        (this.stream as Writable).off('error', this.onStreamError);
        return;
      }
      try {
        await endStream(this.stream, this.boundedExecution, this.onError);
      } finally {
        // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- union event overloads require narrowing
        (this.stream as Writable).off('error', this.onStreamError);
      }
    })();
    return this.closing;
  }

  private writeChunk(chunk: string | Buffer): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const done = (): void => {
        if (settled) return;
        settled = true;
        resolve();
      };
      try {
        let callbackFired = false;
        const ok = this.stream.write(chunk, (error) => {
          callbackFired = true;
          if (error) this.report(error);
          if (ok) done();
        });
        if (ok) return;
        if (callbackFired) return done();
        // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- union event overloads require narrowing
        const writable = this.stream as Writable;
        const cleanup = (): void => {
          writable.off('drain', onDrain);
          writable.off('error', onErrorEvent);
        };
        const onDrain = (): void => {
          cleanup();
          done();
        };
        const onErrorEvent = (error: unknown): void => {
          cleanup();
          this.report(error);
          done();
        };
        writable.on('drain', onDrain);
        writable.on('error', onErrorEvent);
      } catch (error: unknown) {
        this.report(error);
        done();
      }
    });
  }

  private report(error: unknown): void {
    if (!this.onError) return;
    try {
      this.onError(error);
    } catch {
      // Diagnostics must not break writes.
    }
  }
}

async function endStream(
  stream: Writable,
  boundedExecution: BoundedExecution,
  onError?: (error: unknown) => void,
): Promise<void> {
  const waitFor = (event: 'finish' | 'close'): Promise<void> =>
    new Promise((resolve) => {
      if (event === 'finish' && stream.writableFinished) return resolve();
      if (event === 'close' && stream.closed) return resolve();
      const timer = setTimeout(resolve, 5000);
      timer.unref?.();
      stream.once(event, () => {
        clearTimeout(timer);
        resolve();
      });
    });
  const hasFileHandle = 'fd' in stream || 'path' in stream;
  const finished: Promise<void> = hasFileHandle
    ? Promise.all([waitFor('finish'), waitFor('close')]).then(() => undefined)
    : waitFor('finish');
  try {
    stream.end();
    await boundedExecution.run(finished, 5000).catch(() => undefined);
  } catch (error: unknown) {
    if (onError) onError(error);
  }
}
