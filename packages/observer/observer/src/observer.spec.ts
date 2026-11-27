import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CaptureTransport } from '@aldok10/nestjs-observe-logger-testing';
import { MetricReader } from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace';
import { describe, expect, it } from 'vitest';
import {
  OBSERVE_ERROR_TRACKER,
  OBSERVE_LOGGER,
  OBSERVE_METRICS,
  OBSERVE_TRACER,
  ObserverModule,
  ObserverRuntime,
  ObserverService,
  type ObserverOptions,
} from './index.js';

class TestMetricReader extends MetricReader {
  protected async onForceFlush(): Promise<void> {}
  protected async onShutdown(): Promise<void> {}
}

describe('ObserverModule & ObserverRuntime', () => {
  it.each<{
    readonly name: string;
    readonly logger: boolean;
    readonly tracing: boolean;
    readonly metrics: boolean;
  }>([
    { name: 'logger only', logger: true, tracing: false, metrics: false },
    { name: 'tracing only', logger: false, tracing: true, metrics: false },
    { name: 'metrics only', logger: false, tracing: false, metrics: true },
    { name: 'logger + tracing', logger: true, tracing: true, metrics: false },
    { name: 'tracing + metrics', logger: false, tracing: true, metrics: true },
    { name: 'logger + metrics', logger: true, tracing: false, metrics: true },
    { name: 'logger + tracing + metrics', logger: true, tracing: true, metrics: true },
  ])('supports $name via ObserverModule.forRoot', async ({ logger, tracing, metrics }) => {
    const capture = new CaptureTransport();
    const spanExporter = new InMemorySpanExporter();
    const metricReader = new TestMetricReader();

    const options: ObserverOptions = {
      resource: { serviceName: 'observer-test', environment: 'test' },
      ...(logger ? { logger: { enabled: true, transports: [capture] } } : {}),
      ...(tracing
        ? {
            tracing: {
              enabled: true,
              spanProcessors: [new SimpleSpanProcessor({ exporter: spanExporter })],
            },
          }
        : {}),
      ...(metrics ? { metrics: { enabled: true, readers: [metricReader] } } : {}),
    };

    class AppModule {}
    Module({ imports: [ObserverModule.forRoot(options)] })(AppModule);

    const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    const observer = app.get(ObserverService);

    expect(Boolean(observer.logger)).toBe(logger);
    expect(Boolean(observer.tracer)).toBe(tracing);
    expect(Boolean(observer.metrics)).toBe(metrics);
    expect(Boolean(app.get(OBSERVE_LOGGER))).toBe(logger);
    expect(Boolean(app.get(OBSERVE_TRACER))).toBe(tracing);
    expect(Boolean(app.get(OBSERVE_METRICS))).toBe(metrics);

    const health = await observer.health();
    expect(health.status).toBe('healthy');
    expect(health.components).toHaveLength(Number(logger) + Number(tracing) + Number(metrics));

    await app.close();
  });

  it('correlates active span traceId and spanId into logs when logger and tracing are both enabled', async () => {
    const capture = new CaptureTransport();
    const spanExporter = new InMemorySpanExporter();

    const runtime = new ObserverRuntime({
      resource: { serviceName: 'checkout', environment: 'prod' },
      logger: { enabled: true, transports: [capture] },
      tracing: {
        enabled: true,
        spanProcessors: [new SimpleSpanProcessor({ exporter: spanExporter })],
      },
    });
    await runtime.initialize();

    await runtime.tracer?.withSpan('checkout.process', async (span) => {
      runtime.logger?.info('payment authorized', { metadata: { orderId: 'ord-1' } });
      const expected = span.spanContext();
      expect(capture.records).toHaveLength(1);
      expect(capture.records[0]?.traceId).toBe(expected.traceId);
      expect(capture.records[0]?.spanId).toBe(expected.spanId);
      expect(capture.records[0]?.metadata?.['orderId']).toBe('ord-1');
    });

    await runtime.shutdown();
  });

  it('supports ObserverModule.forRootAsync', async () => {
    const capture = new CaptureTransport();
    class AppModule {}
    Module({
      imports: [
        ObserverModule.forRootAsync({
          useFactory: async () => ({
            resource: { serviceName: 'async-svc' },
            logger: { enabled: true, transports: [capture] },
          }),
        }),
      ],
    })(AppModule);

    const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    const observer = app.get(ObserverService);
    observer.logger?.info('async ok');
    expect(capture.records.map((r) => r.message)).toEqual(['async ok']);
    await app.close();
  });

  it('composes optional errorTracking with tracing correlation', async () => {
    const captured: unknown[] = [];
    const spanExporter = new InMemorySpanExporter();

    class AppModule {}
    Module({
      imports: [
        ObserverModule.forRoot({
          resource: { serviceName: 'observer-et', environment: 'test' },
          tracing: {
            enabled: true,
            spanProcessors: [new SimpleSpanProcessor({ exporter: spanExporter })],
          },
          errorTracking: {
            enabled: true,
            destinations: [
              {
                name: 'spy',
                adapter: {
                  name: 'spy',
                  capabilities: {
                    exceptions: true,
                    messages: true,
                    breadcrumbs: false,
                    fingerprinting: false,
                    tags: false,
                    userContext: false,
                    traceCorrelation: true,
                    transactions: false,
                    sessions: false,
                    profiling: false,
                    deliveryMode: 'core-managed',
                  },
                  capture(event) {
                    captured.push(event);
                  },
                },
              },
            ],
          },
        }),
      ],
    })(AppModule);

    const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    const observer = app.get(ObserverService);
    expect(observer.errorTracker).toBeDefined();
    expect(app.get(OBSERVE_ERROR_TRACKER)).toBe(observer.errorTracker);

    await observer.tracer?.withSpan('op', async () => {
      await observer.errorTracker?.captureException(new Error('observed failure'));
    });

    expect(captured).toHaveLength(1);
    expect((captured[0] as { trace?: { traceId?: string } }).trace?.traceId).toBeDefined();
    await app.close();
  });
});
