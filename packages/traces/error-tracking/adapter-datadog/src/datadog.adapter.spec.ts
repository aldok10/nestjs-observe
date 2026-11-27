import { describe, expect, it, vi } from 'vitest';
import { normalizeError } from '@aldok10/nestjs-observe-error-tracking';
import {
  createDatadogAdapter,
  type DatadogSpanLike,
  type DatadogTracerLike,
} from './datadog.adapter.js';

describe('DatadogErrorAdapter', () => {
  it('sets Datadog Error Tracking tags on the active span', () => {
    const setTag = vi.fn();
    const activeSpan: DatadogSpanLike = { setTag };
    const client: DatadogTracerLike = {
      scope: () => ({ active: () => activeSpan }),
    };

    const adapter = createDatadogAdapter({ client });
    adapter.initialize();
    adapter.capture(
      normalizeError(new Error('dd boom'), {
        tags: { team: 'payments' },
      }),
    );

    expect(setTag).toHaveBeenCalledWith('error', expect.any(Error));
    expect(setTag).toHaveBeenCalledWith('error.type', 'Error');
    expect(setTag).toHaveBeenCalledWith('error.msg', 'dd boom');
    expect(setTag).toHaveBeenCalledWith('team', 'payments');
  });

  it('creates and finishes a fallback span when active span is missing', () => {
    const setTag = vi.fn();
    const finish = vi.fn();
    const startSpan = vi.fn(() => ({ setTag, finish }));
    const client: DatadogTracerLike = {
      scope: () => ({ active: () => null }),
      startSpan,
    };

    const adapter = createDatadogAdapter({ client });
    adapter.initialize();
    adapter.capture(normalizeError(new Error('bg boom')));

    expect(startSpan).toHaveBeenCalledWith('error.capture');
    expect(finish).toHaveBeenCalledOnce();
  });
});
