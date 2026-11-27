import { setTimeout as delay } from 'node:timers/promises';
import type {
  FormatterType,
  LogFormatter,
  LogRecord,
  LogTransport,
  TransportHealth,
} from '@aldok10/nestjs-observe-logger-core/contracts';
import { defaultFormatter, resolveFormatter } from '@aldok10/nestjs-observe-logger-core/formatters';
import { BoundedExecution } from '@aldok10/nestjs-observe-logger-core';
import { RedactionEngine } from '@aldok10/nestjs-observe-logger-core/redaction';

export type OverflowPolicy = 'drop-oldest' | 'drop-newest' | 'block' | 'fail';

export interface RemotePayload {
  readonly body: string | Buffer;
  readonly headers?: Record<string, string>;
}

export interface BufferedRemoteTransportOptions {
  readonly endpoint: string;
  readonly name?: string;
  readonly formatter?: FormatterType | LogFormatter;
  readonly batchSize?: number;
  readonly flushIntervalMs?: number;
  readonly queueCapacity?: number;
  readonly overflow?: OverflowPolicy;
  readonly maxRetries?: number;
  readonly baseDelayMs?: number;
  readonly timeoutMs?: number;
  readonly headers?: Record<string, string>;
  readonly fetchImpl?: typeof fetch;
  readonly onError?: (error: unknown) => void;
  readonly onDeadLetter?: (batch: readonly string[], error: unknown) => void | Promise<void>;
}

type Outcome<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_FLUSH_INTERVAL_MS = 1000;
const DEFAULT_QUEUE_CAPACITY = 1000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 100;
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_FLUSH_TIMEOUT_MS = 5000;
const DEFER_ENQUEUE_DELAY_MS = 50;
const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_COOLDOWN_MS = 30_000;
const BACKOFF_JITTER_BASE = 0.5;
const BACKOFF_JITTER_SPAN = 0.5;
const RETRYABLE_HTTP_STATUSES = new Set([408, 429]);

const REMOTE_REDACTION_ENGINE = new RedactionEngine();

function trySync<T>(fn: () => T): Outcome<T> {
  try {
    return { ok: true, value: fn() };
  } catch (error: unknown) {
    return { ok: false, error };
  }
}

function tryAsync<T>(fn: () => T | Promise<T>): Promise<Outcome<T>> {
  return Promise.resolve()
    .then(fn)
    .then(
      (value): Outcome<T> => ({ ok: true, value }),
      (error: unknown): Outcome<T> => ({ ok: false, error }),
    );
}

function clampMinInt(value: number | undefined, fallback: number, min: number): number {
  return Math.max(min, Math.floor(value ?? fallback));
}

function clampMin(value: number | undefined, fallback: number, min: number): number {
  return Math.max(min, value ?? fallback);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeLine(value: string | Buffer): string {
  return typeof value === 'string' ? value : value.toString('utf8');
}

function parseJsonObject(line: string): Record<string, unknown> | undefined {
  if (!line.trimStart().startsWith('{')) return undefined;
  const outcome = trySync(() => JSON.parse(line) as unknown);
  if (!outcome.ok || !isPlainRecord(outcome.value)) return undefined;
  return outcome.value;
}

export function parseRecordFields(line: string): Readonly<Record<string, unknown>> {
  const fallback: Readonly<Record<string, unknown>> = { message: line };
  const parsed = parseJsonObject(line) ?? fallback;
  const safe = REMOTE_REDACTION_ENGINE.sanitize(parsed);
  return isPlainRecord(safe) ? safe : fallback;
}

export function joinEndpoint(endpoint: string, path: string): string {
  return `${endpoint.replace(/\/+$/, '')}${path}`;
}

class HttpStatusError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
    this.name = 'HttpStatusError';
  }
}

function isRetryableDeliveryError(error: unknown): boolean {
  if (!(error instanceof HttpStatusError)) return true;
  if (RETRYABLE_HTTP_STATUSES.has(error.status)) return true;
  if (error.status >= 500) return true;
  return error.status < 400;
}

function extractStringHeaders(rawHeaders: unknown): Record<string, string> | undefined {
  if (!isPlainRecord(rawHeaders)) return undefined;
  const entries = Object.entries(rawHeaders).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

function asPayload(value: unknown): RemotePayload {
  if (!isPlainRecord(value)) {
    throw new TypeError('buildPayload must return an object with a body');
  }
  const body = value['body'];
  if (typeof body !== 'string' && !Buffer.isBuffer(body)) {
    throw new TypeError('buildPayload body must be a string or Buffer');
  }
  const headers = extractStringHeaders(value['headers']);
  return headers !== undefined ? { body, headers } : { body };
}

function resolveHealthStatus(down: boolean, degraded: boolean): TransportHealth['status'] {
  if (down) return 'down';
  if (degraded) return 'degraded';
  return 'healthy';
}

export abstract class BufferedRemoteTransport implements LogTransport {
  readonly name: string;
  protected readonly endpoint: string;
  protected readonly formatter: LogFormatter;
  protected readonly headers: Readonly<Record<string, string>>;
  private readonly fetchImpl: typeof fetch;
  private readonly onError?: (error: unknown) => void;
  private readonly onDeadLetter?: (
    batch: readonly string[],
    error: unknown,
  ) => void | Promise<void>;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private readonly capacity: number;
  private readonly overflow: OverflowPolicy;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly timeoutMs: number;
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly abortController = new AbortController();
  private readonly boundedExecution = new BoundedExecution();
  private readonly queue: string[] = [];
  private readonly pendingWrites = new Set<Promise<void>>();
  private draining: Promise<void> | undefined;
  private closing: Promise<void> | undefined;
  private closed = false;
  private forceDrain = false;
  private cooldownUntil = 0;
  private consecutiveFailures = 0;
  private dropped = 0;
  private sent = 0;
  private failed = 0;
  private lastSuccessAt: number | undefined;
  private lastErrorAt: number | undefined;
  private lastError: string | undefined;

  constructor(options: BufferedRemoteTransportOptions) {
    this.name = options.name ?? 'remote';
    this.endpoint = options.endpoint;
    this.formatter =
      options.formatter === undefined ? defaultFormatter : resolveFormatter(options.formatter);
    this.batchSize = clampMinInt(options.batchSize, DEFAULT_BATCH_SIZE, 1);
    this.flushIntervalMs = clampMinInt(options.flushIntervalMs, DEFAULT_FLUSH_INTERVAL_MS, 1);
    this.capacity = clampMinInt(options.queueCapacity, DEFAULT_QUEUE_CAPACITY, 1);
    this.overflow = options.overflow ?? 'drop-oldest';
    this.maxRetries = clampMinInt(options.maxRetries, DEFAULT_MAX_RETRIES, 0);
    this.baseDelayMs = clampMin(options.baseDelayMs, DEFAULT_BASE_DELAY_MS, 0);
    this.timeoutMs = clampMin(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1);
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.headers = options.headers ?? {};
    if (options.onError) this.onError = options.onError;
    if (options.onDeadLetter) this.onDeadLetter = options.onDeadLetter;

    this.timer = setInterval(() => {
      this.drain().catch((error: unknown) => this.report(error));
    }, this.flushIntervalMs);
    this.timer.unref?.();
  }

  protected abstract buildPayload(batch: readonly string[]): RemotePayload;

  write(record: LogRecord): void {
    if (this.closed) return;

    const formatted = trySync(() => normalizeLine(this.formatter.format(record)));
    if (!formatted.ok) {
      this.dropped += 1;
      this.report(formatted.error);
      return;
    }

    if (this.queue.length < this.capacity) {
      this.queue.push(formatted.value);
      return;
    }

    this.handleOverflow(formatted.value);
  }

  async flush(timeoutMs = DEFAULT_FLUSH_TIMEOUT_MS): Promise<void> {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    await Promise.allSettled(this.pendingWrites);
    await this.flushUntil(deadline);
  }

  close(): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    this.closed = true;
    this.forceDrain = true;
    clearInterval(this.timer);
    this.abortController.abort();
    this.closing = this.flush();
    return this.closing;
  }

  health(): TransportHealth {
    const down = Date.now() < this.cooldownUntil;
    const degraded = this.consecutiveFailures > 0 || this.lastError !== undefined;
    return {
      name: this.name,
      status: resolveHealthStatus(down, degraded),
      healthy: !down && !degraded,
      queued: this.queue.length,
      capacity: this.capacity,
      dropped: this.dropped,
      sent: this.sent,
      failed: this.failed,
      ...(this.lastSuccessAt !== undefined ? { lastSuccessAt: this.lastSuccessAt } : {}),
      ...(this.lastErrorAt !== undefined ? { lastErrorAt: this.lastErrorAt } : {}),
      ...(this.lastError !== undefined ? { lastError: this.lastError } : {}),
    };
  }

  private async flushUntil(deadline: number): Promise<void> {
    if (this.queue.length === 0 || Date.now() >= deadline || !this.canDrain()) return;
    await this.boundedExecution
      .run(this.drain(), Math.max(0, deadline - Date.now()))
      .catch(() => undefined);
    return this.flushUntil(deadline);
  }

  private handleOverflow(line: string): void {
    if (this.overflow === 'block') {
      this.deferEnqueue(line);
      return;
    }

    const overflowError = new Error(`Log queue overflow (${this.overflow}): ${this.name}`);
    this.dropped += 1;
    this.report(overflowError);

    if (this.overflow === 'fail') throw overflowError;
    if (this.overflow === 'drop-newest') return;

    this.queue.shift();
    this.queue.push(line);
  }

  private deferEnqueue(line: string): void {
    const pending = new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingWrites.delete(pending);
        if (this.abortController.signal.aborted || (this.closed && !this.forceDrain)) {
          // A deferred write from a 'block' overflow cannot be delivered after shutdown.
          this.dropped += 1;
          resolve();
          return;
        }
        const canEnqueue = this.forceDrain || (!this.closed && this.queue.length < this.capacity);
        if (!canEnqueue) {
          this.dropped += 1;
          resolve();
          return;
        }
        this.queue.push(line);
        resolve();
      }, DEFER_ENQUEUE_DELAY_MS);
      timer.unref?.();
    });
    this.pendingWrites.add(pending);
  }

  private canDrain(): boolean {
    return this.forceDrain || Date.now() >= this.cooldownUntil;
  }

  private drain(): Promise<void> {
    if (this.draining) return this.draining;
    const running = this.drainNext().finally(() => {
      this.draining = undefined;
    });
    this.draining = running;
    return running;
  }

  private drainNext(): Promise<void> {
    if (this.queue.length === 0 || !this.canDrain()) return Promise.resolve();
    const batch = this.queue.splice(0, this.batchSize);
    return this.sendBatch(batch).then(() => this.drainNext());
  }

  private async sendBatch(batch: readonly string[], attempt = 0): Promise<void> {
    if (attempt > 0 && this.abortController.signal.aborted) {
      this.dropped += batch.length;
      return;
    }
    if (!this.canDrain()) {
      this.queue.unshift(...batch);
      return;
    }

    const outcome = await this.deliverAttempt(batch);
    if (outcome.ok) {
      this.recordSuccess(batch.length);
      return;
    }

    this.recordAttemptError(outcome.error);
    if (!isRetryableDeliveryError(outcome.error) || attempt >= this.maxRetries) {
      await this.recordPermanentFailure(batch, outcome.error);
      return;
    }

    await this.waitForRetry(attempt);
    if (this.abortController.signal.aborted) {
      this.dropped += batch.length;
      return;
    }
    return this.sendBatch(batch, attempt + 1);
  }

  private async deliverAttempt(batch: readonly string[]): Promise<Outcome<void>> {
    const payloadOutcome = trySync(() => asPayload(this.buildPayload(batch)));
    if (!payloadOutcome.ok) return payloadOutcome;

    const { body, headers: payloadHeaders } = payloadOutcome.value;
    const headers: Record<string, string> = { ...this.headers, ...payloadHeaders };
    const responseOutcome = await tryAsync(() =>
      this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      }),
    );
    if (!responseOutcome.ok) return responseOutcome;
    if (!responseOutcome.value.ok) {
      return { ok: false, error: new HttpStatusError(responseOutcome.value.status) };
    }
    return { ok: true, value: undefined };
  }

  private recordSuccess(count: number): void {
    this.sent += count;
    this.lastSuccessAt = Date.now();
    this.lastError = undefined;
    this.consecutiveFailures = 0;
  }

  private recordAttemptError(error: unknown): void {
    this.lastError = error instanceof Error ? error.message : String(error);
    this.lastErrorAt = Date.now();
    this.report(error);
  }

  private async recordPermanentFailure(batch: readonly string[], error: unknown): Promise<void> {
    this.failed += batch.length;
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
      this.cooldownUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
      this.consecutiveFailures = 0;
    }
    await this.notifyDeadLetter(batch, error);
  }

  private async notifyDeadLetter(batch: readonly string[], error: unknown): Promise<void> {
    const handler = this.onDeadLetter;
    if (!handler) return;
    const outcome = await tryAsync(() => handler(batch, error));
    if (!outcome.ok) this.report(outcome.error);
  }

  private async waitForRetry(attempt: number): Promise<void> {
    const jitter = BACKOFF_JITTER_BASE + Math.random() * BACKOFF_JITTER_SPAN;
    const backoffMs = this.baseDelayMs * 2 ** attempt * jitter;
    await delay(backoffMs, undefined, {
      ref: false,
      signal: this.abortController.signal,
    }).catch(() => undefined);
  }

  private report(error: unknown): void {
    const handler = this.onError;
    if (!handler) return;
    trySync(() => handler(error));
  }
}
