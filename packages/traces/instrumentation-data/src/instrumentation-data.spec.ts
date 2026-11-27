import { ObserveTracer, TracingRuntime } from '@aldok10/nestjs-observe-tracing';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace';
import { afterEach, describe, expect, it } from 'vitest';
import {
  traceDbQuery,
  traceQueueConsumer,
  traceQueueProducer,
  traceRedisCommand,
  traceWorkerJob,
} from './index.js';

describe('Data tracing instrumentation helpers', () => {
  let runtime: TracingRuntime | undefined;

  afterEach(async () => {
    if (runtime !== undefined) {
      await runtime.shutdown();
      runtime = undefined;
    }
  });

  it('creates semantic spans for db, redis, queue, and worker', async () => {
    const exporter = new InMemorySpanExporter();
    runtime = new TracingRuntime({ spanProcessors: [new SimpleSpanProcessor({ exporter })] });
    runtime.initialize();
    const tracer = new ObserveTracer(runtime);

    await traceDbQuery(
      tracer,
      { system: 'postgresql', operation: 'SELECT', namespace: 'app' },
      () => 1,
    );
    await traceRedisCommand(tracer, { command: 'GET', dbIndex: 0 }, () => 'val');
    await traceQueueProducer(tracer, { queueName: 'emails', messageId: 'm1' }, () => true);
    await traceQueueConsumer(tracer, { queueName: 'emails', messageId: 'm1' }, () => true);
    await traceWorkerJob(tracer, { jobName: 'invoice-pdf', jobId: 'j1' }, () => 'ok');

    const names = exporter.getFinishedSpans().map((s) => s.name);
    expect(names).toEqual([
      'db.postgresql.SELECT',
      'redis.GET',
      'queue.publish emails',
      'queue.process emails',
      'worker.invoice-pdf',
    ]);
  });
});
