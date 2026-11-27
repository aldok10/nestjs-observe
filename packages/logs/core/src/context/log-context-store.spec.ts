import { describe, expect, it, vi } from 'vitest';
import { LogContextStore } from './index.js';

describe('LogContextStore', () => {
  it('isolates contexts across concurrent async work', async () => {
    const store = new LogContextStore();
    const results = await Promise.all([
      store.run({ requestId: 'a' }, async () => {
        await Promise.resolve();
        return store.get().requestId;
      }),
      store.run({ requestId: 'b' }, async () => {
        await Promise.resolve();
        return store.get().requestId;
      }),
    ]);

    expect(results).toEqual(['a', 'b']);
    expect(store.get()).toEqual({});
  });

  it('merges set() patches into the active context', () => {
    const store = new LogContextStore();
    store.run({ requestId: 'r1', metadata: { a: 1 } }, () => {
      store.set({ traceId: 't1', metadata: { b: 2 } });
      expect(store.get()).toEqual({ requestId: 'r1', traceId: 't1', metadata: { b: 2 } });
    });
  });

  it('returns {} from fromActiveSpan without a provider', () => {
    expect(new LogContextStore().fromActiveSpan()).toEqual({});
  });

  it('uses an injected active-span provider and fails closed when it throws', () => {
    const provider = vi
      .fn()
      .mockReturnValueOnce({ traceId: 't1', spanId: 's1', ignored: 'value' })
      .mockImplementationOnce(() => {
        throw new Error('tracer unavailable');
      });
    const store = new LogContextStore({ activeSpanProvider: provider });

    expect(store.fromActiveSpan()).toEqual({ traceId: 't1', spanId: 's1' });
    expect(store.fromActiveSpan()).toEqual({});
    expect(provider).toHaveBeenCalledTimes(2);
  });
});
