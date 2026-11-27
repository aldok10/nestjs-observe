import { AsyncLocalStorage } from 'node:async_hooks';

export interface ObserveContextData {
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly tenantId?: string;
  readonly jobId?: string;
  readonly workerId?: string;
  readonly traceId?: string;
  readonly spanId?: string;
  readonly attributes?: Readonly<Record<string, unknown>>;
}

export class ObserveContextStore {
  private readonly storage = new AsyncLocalStorage<ObserveContextData>();

  get(): ObserveContextData {
    return this.storage.getStore() ?? {};
  }

  run<T>(context: ObserveContextData, fn: () => T): T {
    const merged = mergeContext(this.get(), context);
    return this.storage.run(merged, fn);
  }

  enterWith(context: ObserveContextData): void {
    this.storage.enterWith(mergeContext(this.get(), context));
  }
}

function mergeContext(
  current: ObserveContextData,
  next: ObserveContextData,
): ObserveContextData {
  const attributes =
    current.attributes !== undefined || next.attributes !== undefined
      ? { ...current.attributes, ...next.attributes }
      : undefined;
  return {
    ...current,
    ...next,
    ...(attributes !== undefined ? { attributes } : {}),
  };
}
