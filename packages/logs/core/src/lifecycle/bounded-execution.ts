export class BoundedExecution {
  async run<T>(work: Promise<T>, timeoutMs?: number): Promise<T> {
    if (timeoutMs === undefined || !Number.isFinite(timeoutMs) || timeoutMs < 0) return work;

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

const DEFAULT_BOUNDED_EXECUTION = new BoundedExecution();

export function withTimeout<T>(work: Promise<T>, timeoutMs?: number): Promise<T> {
  return DEFAULT_BOUNDED_EXECUTION.run(work, timeoutMs);
}
