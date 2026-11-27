import { describe, expect, it } from 'vitest';
import { ObserveContextStore } from '@aldok10/nestjs-observe-core';
import {
  ErrorDeduplicator,
  ErrorTrackingRuntime,
  captureDatabaseError,
  captureJobError,
  createContextEnricher,
  createDeploymentEnricher,
  normalizeError,
  redactErrorEvent,
  type ErrorAdapterCapabilities,
  type ErrorTrackingAdapter,
  type ObserveErrorEvent,
} from './index.js';
import { ObserveErrorTracker } from './observe-error-tracker.service.js';

const CAPABILITIES: ErrorAdapterCapabilities = {
  exceptions: true,
  messages: true,
  breadcrumbs: true,
  fingerprinting: true,
  tags: true,
  userContext: true,
  traceCorrelation: true,
  transactions: false,
  sessions: false,
  profiling: false,
  deliveryMode: 'core-managed',
};

function makeSpyAdapter(
  name: string,
  fail = false,
): {
  adapter: ErrorTrackingAdapter;
  events: ObserveErrorEvent[];
  flushed: number;
  shutDown: number;
} {
  const events: ObserveErrorEvent[] = [];
  const state = { flushed: 0, shutDown: 0 };
  const adapter: ErrorTrackingAdapter = {
    name,
    capabilities: CAPABILITIES,
    capture(event) {
      if (fail) throw new Error(`${name} delivery failure`);
      events.push(event);
    },
    flush() {
      state.flushed += 1;
      return Promise.resolve();
    },
    shutdown() {
      state.shutDown += 1;
      return Promise.resolve();
    },
  };
  return {
    adapter,
    events,
    get flushed() {
      return state.flushed;
    },
    get shutDown() {
      return state.shutDown;
    },
  };
}

describe('normalizeError', () => {
  it('preserves Error stack, nested causes, and cycles safely', () => {
    const root = new Error('root failure');
    const mid = new Error('mid failure', { cause: root });
    const top = new Error('top failure', { cause: mid });
    (root as { cause?: unknown }).cause = top; // cycle

    const event = normalizeError(top, { severity: 'fatal' });
    expect(event.name).toBe('Error');
    expect(event.message).toBe('top failure');
    expect(event.stack).toContain('top failure');
    expect(event.severity).toBe('fatal');
    expect(event.causes).toHaveLength(2);
    expect(event.causes?.[0]?.message).toBe('mid failure');
    expect(event.causes?.[1]?.message).toBe('root failure');
    expect(event.exception).toBe(top);
  });

  it('normalizes AggregateError and non-Error thrown values', () => {
    const agg = new AggregateError([new TypeError('bad type'), 'string reason'], 'batch failed');
    const aggEvent = normalizeError(agg);
    expect(aggEvent.name).toBe('AggregateError');
    expect(aggEvent.aggregateErrors).toHaveLength(2);
    expect(aggEvent.aggregateErrors?.[0]?.name).toBe('TypeError');
    expect(aggEvent.aggregateErrors?.[1]?.message).toBe('string reason');

    const circularObj: Record<string, unknown> = { code: 'E_CONN' };
    circularObj['self'] = circularObj;
    const objEvent = normalizeError(circularObj);
    expect(objEvent.name).toBe('NonErrorObject');
    expect(objEvent.message).toContain('[Circular]');
  });
});

describe('redactErrorEvent', () => {
  it('redacts sensitive headers, credentials in URLs, tokens, and respects allowlist', () => {
    const event = normalizeError(
      new Error('Failed connecting to postgres://admin:s3cr3t@db.internal:5432/app'),
      {
        request: {
          method: 'POST',
          url: 'https://api.example.com?token=abc',
          headers: {
            authorization: 'Bearer secret.jwt.token',
            cookie: 'sid=123',
            'x-request-id': 'req-1',
          },
          body: {
            password: 'my-password',
            publicNote: 'ok',
          },
        },
        attributes: {
          apiKey: 'key-123',
          safeFlag: true,
        },
      },
    );

    const redacted = redactErrorEvent(event, { allowlistKeys: ['x-request-id'] });
    expect(redacted.message).not.toContain('s3cr3t');
    expect(redacted.message).toContain('[REDACTED]@db.internal');
    expect(redacted.request?.headers?.['authorization']).toBe('[REDACTED]');
    expect(redacted.request?.headers?.['cookie']).toBe('[REDACTED]');
    expect(redacted.request?.headers?.['x-request-id']).toBe('req-1');
    expect((redacted.request?.body as Record<string, unknown> | undefined)?.['password']).toBe(
      '[REDACTED]',
    );
    expect((redacted.request?.body as Record<string, unknown> | undefined)?.['publicNote']).toBe(
      'ok',
    );
    expect(redacted.attributes?.['apiKey']).toBe('[REDACTED]');
    expect(redacted.attributes?.['safeFlag']).toBe(true);
  });
});

describe('ErrorDeduplicator', () => {
  it('suppresses exact Error instance duplicates and windowed fingerprint duplicates', () => {
    const dedup = new ErrorDeduplicator({ windowMs: 1000 });
    const err = new Error('boom');
    const e1 = normalizeError(err, { fingerprint: ['pay', 'timeout'] });
    const e2 = normalizeError(err, { fingerprint: ['pay', 'timeout'] });
    expect(dedup.isDuplicate(e1, 100)).toBe(false);
    expect(dedup.isDuplicate(e2, 200)).toBe(true);

    const e3 = normalizeError(new Error('boom'), { fingerprint: ['pay', 'timeout'] });
    expect(dedup.isDuplicate(e3, 300)).toBe(true);
    const e4 = normalizeError(new Error('boom'), { fingerprint: ['pay', 'timeout'] });
    expect(dedup.isDuplicate(e4, 1500)).toBe(false);
  });
});

describe('ErrorTrackingRuntime multi-destination, enrichment, and isolation', () => {
  it('isolates destination failures, applies per-destination filters, and enriches context', async () => {
    const primary = makeSpyAdapter('primary', false);
    const broken = makeSpyAdapter('broken', true);
    const fatalOnly = makeSpyAdapter('fatal-only', false);
    const store = new ObserveContextStore();

    const runtime = new ErrorTrackingRuntime({
      resource: { serviceName: 'orders', environment: 'production', serviceVersion: '1.2.3' },
      enrichers: [
        createDeploymentEnricher({ deployment: 'blue' }),
        createContextEnricher(store),
        {
          name: 'failing-enricher',
          enrich: () => {
            throw new Error('enricher crash');
          },
        },
      ],
      destinations: [
        { name: 'primary', adapter: primary.adapter },
        { name: 'broken', adapter: broken.adapter, delivery: { maxRetries: 0 } },
        {
          name: 'fatal-only',
          adapter: fatalOnly.adapter,
          filter: { minSeverity: 'fatal' },
        },
      ],
    });

    await runtime.initialize();
    runtime.addBreadcrumb({ message: 'checkout started', category: 'http' });

    await store.run({ requestId: 'req-42', tenantId: 't-1' }, async () => {
      await runtime.captureException(new Error('card declined'), { severity: 'error' });
    });

    expect(primary.events).toHaveLength(1);
    expect(fatalOnly.events).toHaveLength(0);
    expect(primary.events[0]?.serviceName).toBe('orders');
    expect(primary.events[0]?.environment).toBe('production');
    expect(primary.events[0]?.release).toBe('1.2.3');
    expect(primary.events[0]?.deployment).toBe('blue');
    expect(primary.events[0]?.context?.requestId).toBe('req-42');
    expect(primary.events[0]?.breadcrumbs).toHaveLength(1);

    const diag = await runtime.getDiagnostics();
    expect(diag.status).toBe('degraded');
    expect(diag.destinations.find((d) => d.name === 'broken')?.failedCount).toBe(1);
    expect(diag.destinations.find((d) => d.name === 'primary')?.sentCount).toBe(1);

    await runtime.shutdown();
  });

  it('never samples away fatal errors by default', async () => {
    const spy = makeSpyAdapter('spy');
    const runtime = new ErrorTrackingRuntime({
      sampling: { rate: 0 },
      destinations: [{ name: 'spy', adapter: spy.adapter }],
    });
    await runtime.initialize();

    await runtime.captureException(new Error('normal'), { severity: 'error' });
    await runtime.captureException(new Error('critical'), { severity: 'fatal' });

    expect(spy.events).toHaveLength(1);
    expect(spy.events[0]?.severity).toBe('fatal');
    await runtime.shutdown();
  });

  it('supports background job and database error helpers', async () => {
    const spy = makeSpyAdapter('spy');
    const runtime = new ErrorTrackingRuntime({
      destinations: [{ name: 'spy', adapter: spy.adapter }],
    });
    await runtime.initialize();
    const tracker = new ObserveErrorTracker(runtime);

    // Retry 1 of 3 should be suppressed when reportOnFinalAttemptOnly=true
    const skipped = await captureJobError(
      tracker,
      new Error('transient'),
      { queueName: 'emails', jobId: 'j1', attemptsMade: 1, maxAttempts: 3 },
      { reportOnFinalAttemptOnly: true },
    );
    expect(skipped).toBeUndefined();

    // Final attempt should report
    await captureJobError(
      tracker,
      new Error('permanent'),
      { queueName: 'emails', jobId: 'j1', attemptsMade: 3, maxAttempts: 3 },
      { reportOnFinalAttemptOnly: true },
    );

    const dbErr = Object.assign(new Error('postgres://user:pass@localhost:5432/db failed'), {
      code: 'ECONNREFUSED',
    });
    await captureDatabaseError(tracker, dbErr, {
      system: 'postgresql',
      operation: 'SELECT',
      durationMs: 120,
    });

    expect(spy.events).toHaveLength(2);
    expect(spy.events[0]?.job?.queueName).toBe('emails');
    expect(spy.events[1]?.database?.system).toBe('postgresql');
    expect(spy.events[1]?.message).not.toContain('pass');
    await runtime.shutdown();
  });
});
