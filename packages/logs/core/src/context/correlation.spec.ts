import { describe, expect, it } from 'vitest';
import {
  createCorrelationContext,
  generateCorrelationId,
  generateRequestId,
  generateSpanId,
  generateTraceId,
} from './index.js';

describe('correlation utilities', () => {
  it('generates request and correlation ids', () => {
    expect(generateRequestId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(generateCorrelationId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('generates W3C-shaped trace and span ids', () => {
    expect(generateTraceId()).toMatch(/^[0-9a-f]{32}$/);
    expect(generateSpanId()).toMatch(/^[0-9a-f]{16}$/);
  });

  it('creates correlation context with seed precedence', () => {
    const ctx = createCorrelationContext({ requestId: 'req-1', context: 'Orders' });
    expect(ctx.requestId).toBe('req-1');
    expect(ctx.correlationId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(ctx.context).toBe('Orders');
  });
});
