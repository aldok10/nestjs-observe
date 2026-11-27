import type {
  LogPipelineOptions,
  LogRecord,
  LogTransport,
  TransportHealth,
} from '../contracts/index.js';
import { BoundedExecution } from '../lifecycle/bounded-execution.js';
import { RedactionEngine, safeString, sanitize } from '../redaction/redaction-engine.js';

interface TransportCounters {
  sent: number;
  failed: number;
  consecutiveFailures: number;
  lastSuccessAt?: number | undefined;
  lastErrorAt?: number | undefined;
  lastError?: string | undefined;
}

function createCounters(): TransportCounters {
  return { sent: 0, failed: 0, consecutiveFailures: 0 };
}

export class LogPipeline {
  private readonly options: LogPipelineOptions;
  private readonly redactionEngine: RedactionEngine;
  private readonly boundedExecution = new BoundedExecution();
  private readonly counters = new Map<LogTransport, TransportCounters>();
  private closePromise: Promise<void> | undefined;
  private closed = false;
  private pendingEmits = 0;
  private readonly emitWaiters: Array<() => void> = [];

  constructor(options: LogPipelineOptions) {
    this.options = options;
    this.redactionEngine = new RedactionEngine(options.redaction);
    for (const transport of options.transports) this.counters.set(transport, createCounters());
  }

  async emit(record: LogRecord): Promise<void> {
    if (this.closed) return;
    this.pendingEmits += 1;
    try {
      const safe = this.redactionEngine.redactRecord(record);
      const writes = this.options.transports.map(async (transport) => {
        try {
          await transport.write(safe);
          this.recordSuccess(transport);
        } catch (error: unknown) {
          this.recordFailure(transport, error);
        }
      });
      await Promise.allSettled(writes);
    } finally {
      this.pendingEmits -= 1;
      if (this.pendingEmits === 0) {
        for (const resolve of this.emitWaiters.splice(0)) resolve();
      }
    }
  }

  async flush(timeoutMs?: number): Promise<void> {
    const jobs = this.options.transports.map(async (transport) => {
      if (transport.flush !== undefined) await transport.flush(timeoutMs);
    });
    await this.bounded(jobs, timeoutMs);
  }

  close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise;
    this.closed = true;
    this.closePromise = (async () => {
      await this.bounded([this.waitForPendingEmits()], 5000);
      const jobs = this.options.transports.map(async (transport) => {
        if (transport.close !== undefined) await transport.close();
      });
      await this.bounded(jobs);
    })();
    return this.closePromise;
  }

  health(): readonly TransportHealth[] {
    return this.options.transports.map((transport) => {
      let base: TransportHealth | undefined;
      try {
        base = transport.health?.();
      } catch {
        base = undefined;
      }
      const counters = this.counters.get(transport) ?? createCounters();
      const lastSuccessAt = counters.lastSuccessAt ?? base?.lastSuccessAt;
      const lastErrorAt = counters.lastErrorAt ?? base?.lastErrorAt;
      const lastError = counters.lastError ?? base?.lastError;
      return {
        name: base?.name ?? transport.name,
        status: base?.status ?? (counters.consecutiveFailures > 0 ? 'degraded' : 'healthy'),
        healthy: base?.healthy ?? counters.consecutiveFailures === 0,
        queued: base?.queued ?? 0,
        capacity: base?.capacity ?? 0,
        dropped: base?.dropped ?? 0,
        sent: Math.max(base?.sent ?? 0, counters.sent),
        failed: Math.max(base?.failed ?? 0, counters.failed),
        ...(lastSuccessAt === undefined ? {} : { lastSuccessAt }),
        ...(lastErrorAt === undefined ? {} : { lastErrorAt }),
        ...(lastError === undefined ? {} : { lastError }),
      };
    });
  }

  private waitForPendingEmits(): Promise<void> {
    if (this.pendingEmits === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.emitWaiters.push(resolve);
    });
  }

  private async bounded(jobs: readonly Promise<void>[], timeoutMs?: number): Promise<void> {
    try {
      await this.boundedExecution.run(
        Promise.allSettled(jobs).then(() => undefined),
        timeoutMs,
      );
    } catch {
      // Bounded shutdown: stop waiting rather than leaking a rejected timer.
    }
  }

  private recordSuccess(transport: LogTransport): void {
    const counters = this.counters.get(transport) ?? createCounters();
    counters.sent += 1;
    counters.consecutiveFailures = 0;
    counters.lastSuccessAt = Date.now();
    this.counters.set(transport, counters);
  }

  private recordFailure(transport: LogTransport, error: unknown): void {
    const counters = this.counters.get(transport) ?? createCounters();
    counters.failed += 1;
    counters.consecutiveFailures += 1;
    counters.lastErrorAt = Date.now();
    counters.lastError = safeString(sanitize(error instanceof Error ? error.message : error));
    this.counters.set(transport, counters);
    try {
      this.options.onTransportError?.(transport.name, error);
    } catch {
      // A broken error hook must not affect delivery.
    }
  }
}
