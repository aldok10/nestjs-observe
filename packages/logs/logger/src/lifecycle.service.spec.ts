import { describe, expect, it, vi } from 'vitest';
import type {
  LoggerAdapter,
  LoggerAdapterOptions,
} from '@aldok10/nestjs-observe-logger-core/contracts';
import { LifecycleService } from './lifecycle.service.js';

function adapter(name: string, initialize?: () => Promise<void>) {
  return {
    name,
    initialize: initialize === undefined ? undefined : vi.fn(initialize),
    dispose: vi.fn(async () => undefined),
  } as unknown as LoggerAdapter & {
    initialize?: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  };
}

describe('LifecycleService', () => {
  it('rolls back initialized adapters and allows a retry after failed init', async () => {
    let fail = true;
    const first = adapter('first', async () => undefined);
    const second = adapter('second', async () => {
      if (fail) throw new Error('init failed');
    });
    const service = new LifecycleService(
      { shutdown: vi.fn(async () => undefined) },
      [first, second],
      { level: 'info' } satisfies LoggerAdapterOptions,
    );

    await expect(service.onModuleInit()).rejects.toThrow('init failed');
    expect(first.dispose).toHaveBeenCalledTimes(1);

    fail = false;
    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(second.initialize).toHaveBeenCalledTimes(2);
  });
});
