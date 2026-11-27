import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import {
  ErrorTrackingModule,
  ObserveErrorTracker,
  ObserveExceptionFilter,
  type ErrorAdapterCapabilities,
  type ErrorTrackingAdapter,
  type ObserveErrorEvent,
} from './index.js';
import { createErrorTrackingLogTransport, createTracingErrorBridge } from './bridges.js';

const CAPABILITIES: ErrorAdapterCapabilities = {
  exceptions: true,
  messages: true,
  breadcrumbs: false,
  fingerprinting: true,
  tags: true,
  userContext: false,
  traceCorrelation: true,
  transactions: false,
  sessions: false,
  profiling: false,
  deliveryMode: 'core-managed',
};

function makeSpyAdapter(): { adapter: ErrorTrackingAdapter; events: ObserveErrorEvent[] } {
  const events: ObserveErrorEvent[] = [];
  return {
    events,
    adapter: {
      name: 'spy',
      capabilities: CAPABILITIES,
      capture(event) {
        events.push(event);
      },
    },
  };
}

describe('NestJS ErrorTrackingModule, ExceptionFilter, and Bridges', () => {
  it('boots ErrorTrackingModule.forRoot and shuts down cleanly', async () => {
    const spy = makeSpyAdapter();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ErrorTrackingModule.forRoot({
          destinations: [{ name: 'spy', adapter: spy.adapter }],
        }),
      ],
    }).compile();

    await moduleRef.init();
    const tracker = moduleRef.get(ObserveErrorTracker);
    await tracker.captureException(new Error('module boom'));
    expect(spy.events).toHaveLength(1);
    await moduleRef.close();
  });

  it('captures exceptions via ObserveExceptionFilter and strips sensitive headers', async () => {
    const spy = makeSpyAdapter();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ErrorTrackingModule.forRoot({
          destinations: [{ name: 'spy', adapter: spy.adapter }],
        }),
      ],
    }).compile();
    await moduleRef.init();

    const tracker = moduleRef.get(ObserveErrorTracker);
    const reply = vi.fn();
    const filter = new ObserveExceptionFilter(tracker, {
      httpAdapter: { reply } as never,
    } as never);

    const mockHost = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'GET',
          url: '/pay',
          headers: { authorization: 'Bearer secret', 'x-ok': 'yes' },
        }),
        getResponse: () => ({}),
      }),
    };

    filter.catch(new Error('handler failed'), mockHost as never);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(reply).toHaveBeenCalledWith(
      expect.anything(),
      { statusCode: 500, message: 'Internal server error' },
      500,
    );
    expect(spy.events).toHaveLength(1);
    expect(spy.events[0]?.request?.headers?.['authorization']).toBe('[REDACTED]');
    expect(spy.events[0]?.request?.headers?.['x-ok']).toBe('yes');
    await moduleRef.close();
  });

  it('bridges Logger and Tracing without duplicating identical Error instances', async () => {
    const spy = makeSpyAdapter();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ErrorTrackingModule.forRoot({
          destinations: [{ name: 'spy', adapter: spy.adapter }],
        }),
      ],
    }).compile();
    await moduleRef.init();

    const tracker = moduleRef.get(ObserveErrorTracker);
    const logBridge = createErrorTrackingLogTransport(tracker, { minSeverity: 'error' });
    const traceBridge = createTracingErrorBridge(tracker);

    const recordException = vi.fn();
    const setStatus = vi.fn();
    const err = new Error('shared failure');

    await traceBridge.recordAndCaptureException(
      {
        recordException,
        setStatus,
        spanContext: () => ({ traceId: 'abc123', spanId: 'def456', traceFlags: 1 }),
      },
      err,
    );

    // Info log is ignored; error log with same message within dedup window is suppressed
    logBridge.write({ level: 'info', message: 'ignored' });
    logBridge.write({
      level: 'error',
      message: 'shared failure',
      error: {
        name: 'Error',
        message: 'shared failure',
        ...(err.stack !== undefined ? { stack: err.stack } : {}),
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(recordException).toHaveBeenCalledWith(err);
    expect(setStatus).toHaveBeenCalledWith({ code: 2, message: 'shared failure' });
    expect(spy.events).toHaveLength(1);
    expect(spy.events[0]?.trace?.traceId).toBe('abc123');
    await moduleRef.close();
  });
});
