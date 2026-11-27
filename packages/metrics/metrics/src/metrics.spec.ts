import { Injectable, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MetricReader } from '@opentelemetry/sdk-metrics';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CardinalityGuard,
  MetricCounter,
  MetricHistogram,
  MetricsModule,
  type MetricsRuntime,
  ObserveMetrics,
  bootstrapMetrics,
} from './index.js';

class TestReader extends MetricReader {
  protected async onForceFlush(): Promise<void> {}
  protected async onShutdown(): Promise<void> {}
}

describe('MetricsRuntime, CardinalityGuard & ObserveMetrics', () => {
  let runtime: MetricsRuntime | undefined;

  afterEach(async () => {
    if (runtime !== undefined) {
      await runtime.shutdown();
      runtime = undefined;
    }
  });

  it('reuses cached instruments and protects cardinality', async () => {
    const reader = new TestReader();
    runtime = bootstrapMetrics({
      resource: { serviceName: 'billing' },
      readers: [reader],
      cardinality: { maxDistinctValuesPerKey: 2 },
    });
    // Duplicate initialize is a safe no-op
    runtime.initialize();

    const svc = new ObserveMetrics(runtime, { maxDistinctValuesPerKey: 2 });
    const c1 = svc.counter('orders.created');
    const c2 = svc.counter('orders.created');
    c1.add(1, { region: 'us', userId: 'u-1' });
    c2.add(2, { region: 'eu', requestId: 'r-2' });
    c2.add(3, { region: 'ap', traceId: 't-3' });

    svc.histogram('orders.amount').record(42.5, { currency: 'USD' });
    svc.upDownCounter('orders.inflight').add(1);
    svc.gauge('orders.queue_lag').record(5);

    const guard = new CardinalityGuard({ maxDistinctValuesPerKey: 1 });
    expect(guard.sanitize({ userId: 'secret', route: '/a' })).toEqual({ route: '/a' });
    expect(guard.sanitize({ route: '/b' })).toEqual({ route: '__overflow__' });

    const { resourceMetrics } = await reader.collect();
    const metricsList = resourceMetrics.scopeMetrics[0]?.metrics ?? [];
    const ordersMetric = metricsList.find((m) => m.descriptor.name === 'orders.created');
    expect(ordersMetric).toBeDefined();
    expect(ordersMetric?.dataPoints.map((dp) => dp.attributes['userId'])).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(ordersMetric?.dataPoints.map((dp) => dp.attributes['region'])).toEqual([
      'us',
      'eu',
      '__overflow__',
    ]);
  });

  it('supports @MetricCounter and @MetricHistogram decorators and MetricsModule.forRoot', async () => {
    const reader = new TestReader();

    class CheckoutService {
      constructor(readonly metrics: ObserveMetrics) {}
      async process(): Promise<string> {
        this.metrics.counter('checkout.manual').add(1);
        return 'ok';
      }
    }
    Injectable()(CheckoutService);
    Reflect.defineMetadata('design:paramtypes', [ObserveMetrics], CheckoutService);

    const desc = Object.getOwnPropertyDescriptor(CheckoutService.prototype, 'process')!;
    MetricCounter('checkout.calls')(CheckoutService.prototype, 'process', desc);
    MetricHistogram('checkout.duration')(CheckoutService.prototype, 'process', desc);
    Object.defineProperty(CheckoutService.prototype, 'process', desc);

    class AppModule {}
    Module({
      imports: [MetricsModule.forRoot({ readers: [reader] })],
      providers: [CheckoutService],
    })(AppModule);

    const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    await expect(app.get(CheckoutService).process()).resolves.toBe('ok');

    const { resourceMetrics } = await reader.collect();
    const names = resourceMetrics.scopeMetrics.flatMap((s) =>
      s.metrics.map((m) => m.descriptor.name),
    );
    expect(names).toEqual(
      expect.arrayContaining(['checkout.manual', 'checkout.calls', 'checkout.duration']),
    );
    await app.close();
  });
});
