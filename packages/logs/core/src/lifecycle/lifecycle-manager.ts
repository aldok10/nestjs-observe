import type { LogTransport } from '../contracts/index.js';
import { TransportShutdownException } from '../exceptions/index.js';
import { BoundedExecution } from './bounded-execution.js';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class LifecycleManager {
  private readonly transports: LogTransport[] = [];
  private readonly boundedExecution = new BoundedExecution();
  private shutdownInFlight: Promise<void> | undefined;

  register(...transports: readonly LogTransport[]): void {
    this.transports.push(...transports);
  }

  async flush(timeoutMs?: number): Promise<void> {
    const jobs = this.transports.map(async (transport) => {
      if (transport.flush !== undefined) await transport.flush(timeoutMs);
    });
    await this.bounded(jobs, timeoutMs);
  }

  // `signal` is accepted for caller compatibility; no process listeners are installed.
  shutdown(_signal?: string, timeoutMs?: number): Promise<void> {
    if (this.shutdownInFlight !== undefined) return this.shutdownInFlight;
    this.shutdownInFlight = this.teardown(timeoutMs);
    return this.shutdownInFlight;
  }

  get shutdownPromise(): Promise<void> | undefined {
    return this.shutdownInFlight;
  }

  private async teardown(timeoutMs?: number): Promise<void> {
    // Flush keeps its bounded, best-effort semantics; only close failures surface here.
    await this.flush(timeoutMs);
    const jobs = this.transports.map(async (transport) => {
      if (transport.close !== undefined) await transport.close();
    });
    let results: readonly PromiseSettledResult<void>[] = [];
    try {
      results = await this.boundedExecution.run(Promise.allSettled(jobs), timeoutMs);
    } catch {
      // Bounded shutdown: stop waiting rather than leaking a rejected timer.
    }
    const failures = results.flatMap((result, index) =>
      result.status === 'rejected'
        ? [`${this.transports[index]?.name ?? 'transport'}: ${errorMessage(result.reason)}`]
        : [],
    );
    if (failures.length > 0) throw new TransportShutdownException(failures);
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
}
