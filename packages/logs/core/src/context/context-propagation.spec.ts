import { describe, expect, it } from 'vitest';
import { LogContextStore, mergeContexts } from './index.js';

describe('context propagation', () => {
  it('supports nested context scopes without leaking', async () => {
    const store = new LogContextStore();

    await store.run({ requestId: 'root', metadata: { a: 1 } }, async () => {
      expect(store.get().requestId).toBe('root');
      await store.run({ requestId: 'child', metadata: { b: 2 } }, async () => {
        await Promise.resolve();
        expect(store.get().requestId).toBe('child');
        expect(store.get().metadata).toEqual({ b: 2 });
      });
      expect(store.get().requestId).toBe('root');
      expect(store.get().metadata).toEqual({ a: 1 });
    });

    expect(store.get()).toEqual({});
  });

  it('applies explicit override precedence deterministically', () => {
    const inherited = { requestId: 'r1', correlationId: 'c1', metadata: { a: 1, shared: 'old' } };
    const explicit = { requestId: 'r2', metadata: { b: 2, shared: 'new' } };
    expect(mergeContexts(inherited, explicit)).toEqual({
      requestId: 'r2',
      correlationId: 'c1',
      metadata: { a: 1, shared: 'new', b: 2 },
    });
  });
});
