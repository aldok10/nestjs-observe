import { Injectable, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SpanStatusCode } from '@opentelemetry/api';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ObserveTracer,
  Trace,
  TracingModule,
  type TracingRuntime,
  bootstrapTracing,
} from './index.js';

describe('TracingRuntime & ObserveTracer', () => {
  let runtime: TracingRuntime | undefined;

  afterEach(async () => {
    if (runtime !== undefined) {
      await runtime.shutdown();
      runtime = undefined;
    }
  });

  it('creates parent-child spans, records attributes/events/exceptions, and propagates baggage', async () => {
    const exporter = new InMemorySpanExporter();
    runtime = bootstrapTracing({
      resource: { serviceName: 'orders', environment: 'test' },
      spanProcessors: [new SimpleSpanProcessor({ exporter })],
    });
    // Duplicate initialize is a safe no-op
    runtime.initialize();

    const tracer = new ObserveTracer(runtime);
    const result = await tracer.withBaggage({ tenant: 'acme' }, async () => {
      return await tracer.withSpan('order.create', async (parent) => {
        expect(tracer.getBaggageEntry('tenant')).toBe('acme');
        const ctx = tracer.getTraceContext();
        expect(ctx.traceId).toBeDefined();
        expect(ctx.spanId).toBe(parent.spanContext().spanId);

        tracer.setAttribute('order.id', 'o-1');
        tracer.addEvent('validated');

        return await tracer.withSpan('order.save', async () => 'saved');
      });
    });

    expect(result).toBe('saved');
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(2);
    const child = spans.find((s) => s.name === 'order.save');
    const parent = spans.find((s) => s.name === 'order.create');
    expect(child?.parentSpanContext?.spanId).toBe(parent?.spanContext().spanId);
    expect(parent?.attributes['order.id']).toBe('o-1');
    expect(parent?.events.map((e) => e.name)).toContain('validated');
  });

  it('supports @Trace() decorator on sync and async methods and records errors', async () => {
    const exporter = new InMemorySpanExporter();
    runtime = bootstrapTracing({
      spanProcessors: [new SimpleSpanProcessor({ exporter })],
    });

    class SampleService {
      async succeed(value: string): Promise<string> {
        return value.toUpperCase();
      }

      fail(): never {
        throw new Error('boom');
      }
    }

    const succeedDesc = Object.getOwnPropertyDescriptor(SampleService.prototype, 'succeed')!;
    Trace('sample.succeed')(SampleService.prototype, 'succeed', succeedDesc);
    Object.defineProperty(SampleService.prototype, 'succeed', succeedDesc);

    const failDesc = Object.getOwnPropertyDescriptor(SampleService.prototype, 'fail')!;
    Trace()(SampleService.prototype, 'fail', failDesc);
    Object.defineProperty(SampleService.prototype, 'fail', failDesc);

    const svc = new SampleService();
    await expect(svc.succeed('ok')).resolves.toBe('OK');
    expect(() => svc.fail()).toThrow('boom');

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(2);
    expect(spans[0]?.name).toBe('sample.succeed');
    expect(spans[0]?.status.code).toBe(SpanStatusCode.OK);
    expect(spans[1]?.name).toBe('SampleService.fail');
    expect(spans[1]?.status.code).toBe(SpanStatusCode.ERROR);
    expect(spans[1]?.events.some((e) => e.name === 'exception')).toBe(true);
  });

  it('integrates with NestJS TracingModule.forRoot and shuts down cleanly', async () => {
    const exporter = new InMemorySpanExporter();

    class PaymentService {
      constructor(readonly tracer: ObserveTracer) {}
      run(): Promise<string> {
        return this.tracer.withSpan('payment.run', async () => 'done');
      }
    }
    Injectable()(PaymentService);
    Reflect.defineMetadata('design:paramtypes', [ObserveTracer], PaymentService);

    class AppModule {}
    Module({
      imports: [
        TracingModule.forRoot({
          resource: { serviceName: 'payments' },
          spanProcessors: [new SimpleSpanProcessor({ exporter })],
        }),
      ],
      providers: [PaymentService],
    })(AppModule);

    const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    const svc = app.get(PaymentService);
    await expect(svc.run()).resolves.toBe('done');
    expect(exporter.getFinishedSpans().map((s) => s.name)).toContain('payment.run');
    await app.close();
  });
});
