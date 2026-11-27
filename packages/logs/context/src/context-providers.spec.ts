import { LogContextStore } from '@aldok10/nestjs-observe-logger-core/context';
import type { LogContext, LogContextProvider } from '@aldok10/nestjs-observe-logger-core/contracts';
import { describe, expect, it } from 'vitest';
import { composeContextProviders, createContextProvider } from './index.js';

const provider = (getContext: () => LogContext | undefined): LogContextProvider =>
  createContextProvider(getContext);

describe('context provider helpers', () => {
  it('applies later providers deterministically and merges metadata', () => {
    const composed = composeContextProviders(
      provider(() => ({ requestId: 'r1', metadata: { a: 1, shared: 'old' } })),
      provider(() => ({ requestId: 'r2', metadata: { b: 2, shared: 'new' } })),
    );

    expect(composed.getContext()).toEqual({
      requestId: 'r2',
      metadata: { a: 1, shared: 'new', b: 2 },
    });
  });

  it('skips a throwing provider without losing the others', () => {
    const composed = composeContextProviders(
      provider(() => {
        throw new Error('provider unavailable');
      }),
      provider(() => ({ traceId: 't1' })),
    );

    expect(composed.getContext()).toEqual({ traceId: 't1' });
  });

  it('returns undefined when no provider supplies context', () => {
    expect(composeContextProviders().getContext()).toBeUndefined();
    expect(composeContextProviders(provider(() => undefined)).getContext()).toBeUndefined();
  });

  it('delegates runWithContext to the canonical store without leaking scope', async () => {
    const store = new LogContextStore();
    const composed = composeContextProviders(
      provider(() => ({ context: 'svc' })),
      store,
    );

    const results = await Promise.all([
      composed.runWithContext?.({ requestId: 'a' }, async () => {
        await Promise.resolve();
        return store.get().requestId;
      }),
      composed.runWithContext?.({ requestId: 'b' }, async () => {
        await Promise.resolve();
        return store.get().requestId;
      }),
    ]);

    expect(results).toEqual(['a', 'b']);
    expect(composed.getContext()).toEqual({ context: 'svc' });
  });
});
