import { setTimeout as delay } from 'node:timers/promises';

export class BoundedExecution {
  async run<T>(work: Promise<T>, timeoutMs?: number): Promise<T> {
    if (timeoutMs === undefined || !Number.isFinite(timeoutMs) || timeoutMs < 0) return work;

    const controller = new AbortController();
    const timeoutPromise = delay(timeoutMs, undefined, {
      ref: false,
      signal: controller.signal,
    }).then((): never => {
      throw new Error(`timed out after ${timeoutMs}ms`);
    });

    try {
      return await Promise.race([work, timeoutPromise]);
    } finally {
      controller.abort();
    }
  }
}

const DEFAULT_BOUNDED_EXECUTION = new BoundedExecution();

export function withTimeout<T>(work: Promise<T>, timeoutMs?: number): Promise<T> {
  return DEFAULT_BOUNDED_EXECUTION.run(work, timeoutMs);
}
