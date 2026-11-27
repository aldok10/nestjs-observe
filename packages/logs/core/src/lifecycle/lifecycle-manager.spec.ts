import { describe, expect, it, vi } from 'vitest';
import { TransportShutdownException } from '../exceptions/index.js';
import { LifecycleManager } from './index.js';

describe('LifecycleManager', () => {
  it('flushes then closes all transports, tolerating flush failures', async () => {
    const events: string[] = [];
    const manager = new LifecycleManager();
    manager.register(
      {
        name: 'one',
        write() {},
        async flush() {
          events.push('flush-one');
        },
        async close() {
          events.push('close-one');
        },
      },
      {
        name: 'two',
        write() {},
        async flush() {
          events.push('flush-two');
          throw new Error('flush failed');
        },
        async close() {
          events.push('close-two');
        },
      },
    );

    await expect(manager.shutdown('SIGTERM', 100)).resolves.toBeUndefined();
    expect(events).toEqual(['flush-one', 'flush-two', 'close-one', 'close-two']);
  });

  it('caches the shutdown promise and bounds a hung flush', async () => {
    const close = vi.fn(async () => {});
    const manager = new LifecycleManager();
    manager.register({
      name: 'hung',
      write() {},
      flush: () => new Promise<void>(() => {}),
      close,
    });

    const start = Date.now();
    const first = manager.shutdown('SIGINT', 10);
    expect(manager.shutdownPromise).toBe(first);
    expect(manager.shutdown('SIGINT', 50)).toBe(first);
    await first;
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('aggregates close failures in TransportShutdownException and caches the rejected promise', async () => {
    const events: string[] = [];
    const manager = new LifecycleManager();
    manager.register(
      {
        name: 'one',
        write() {},
        async close() {
          events.push('close-one');
          throw new Error('one failed');
        },
      },
      {
        name: 'two',
        write() {},
        async close() {
          events.push('close-two');
          throw new Error('two failed');
        },
      },
    );

    const first = manager.shutdown('SIGTERM', 100);
    expect(manager.shutdown('SIGTERM', 100)).toBe(first);
    await expect(first).rejects.toThrow(TransportShutdownException);
    await expect(first).rejects.toThrow(/one failed.*two failed/);
    expect(events).toEqual(['close-one', 'close-two']);
  });
});
