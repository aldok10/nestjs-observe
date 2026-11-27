import type { ObserveTracer } from '@aldok10/nestjs-observe-tracing';
import { SpanKind, type Attributes } from '@opentelemetry/api';
import {
  ATTR_DB_NAMESPACE,
  ATTR_DB_OPERATION_NAME,
  ATTR_DB_SYSTEM_NAME,
} from '@opentelemetry/semantic-conventions';

export interface DbSpanOptions {
  readonly system: string;
  readonly operation: string;
  readonly namespace?: string;
  readonly attributes?: Attributes;
}

export async function traceDbQuery<T>(
  tracer: ObserveTracer,
  options: DbSpanOptions,
  fn: () => Promise<T> | T,
): Promise<T> {
  return await tracer.withSpan(
    `db.${options.system}.${options.operation}`,
    async () => await fn(),
    {
      kind: SpanKind.CLIENT,
      attributes: {
        [ATTR_DB_SYSTEM_NAME]: options.system,
        [ATTR_DB_OPERATION_NAME]: options.operation,
        ...(options.namespace !== undefined ? { [ATTR_DB_NAMESPACE]: options.namespace } : {}),
        ...options.attributes,
      },
    },
  );
}

export interface RedisSpanOptions {
  readonly command: string;
  readonly dbIndex?: number;
  readonly attributes?: Attributes;
}

export async function traceRedisCommand<T>(
  tracer: ObserveTracer,
  options: RedisSpanOptions,
  fn: () => Promise<T> | T,
): Promise<T> {
  return await tracer.withSpan(`redis.${options.command}`, async () => await fn(), {
    kind: SpanKind.CLIENT,
    attributes: {
      [ATTR_DB_SYSTEM_NAME]: 'redis',
      [ATTR_DB_OPERATION_NAME]: options.command,
      ...(options.dbIndex !== undefined ? { [ATTR_DB_NAMESPACE]: String(options.dbIndex) } : {}),
      ...options.attributes,
    },
  });
}

export interface QueueSpanOptions {
  readonly queueName: string;
  readonly messageId?: string;
  readonly attributes?: Attributes;
}

export async function traceQueueProducer<T>(
  tracer: ObserveTracer,
  options: QueueSpanOptions,
  fn: () => Promise<T> | T,
): Promise<T> {
  return await tracer.withSpan(`queue.publish ${options.queueName}`, async () => await fn(), {
    kind: SpanKind.PRODUCER,
    attributes: {
      'messaging.destination.name': options.queueName,
      'messaging.operation.type': 'publish',
      ...(options.messageId !== undefined ? { 'messaging.message.id': options.messageId } : {}),
      ...options.attributes,
    },
  });
}

export async function traceQueueConsumer<T>(
  tracer: ObserveTracer,
  options: QueueSpanOptions,
  fn: () => Promise<T> | T,
): Promise<T> {
  return await tracer.withSpan(`queue.process ${options.queueName}`, async () => await fn(), {
    kind: SpanKind.CONSUMER,
    attributes: {
      'messaging.destination.name': options.queueName,
      'messaging.operation.type': 'process',
      ...(options.messageId !== undefined ? { 'messaging.message.id': options.messageId } : {}),
      ...options.attributes,
    },
  });
}

export interface WorkerSpanOptions {
  readonly jobName: string;
  readonly jobId?: string;
  readonly attributes?: Attributes;
}

export async function traceWorkerJob<T>(
  tracer: ObserveTracer,
  options: WorkerSpanOptions,
  fn: () => Promise<T> | T,
): Promise<T> {
  return await tracer.withSpan(`worker.${options.jobName}`, async () => await fn(), {
    kind: SpanKind.INTERNAL,
    attributes: {
      'worker.job.name': options.jobName,
      ...(options.jobId !== undefined ? { 'worker.job.id': options.jobId } : {}),
      ...options.attributes,
    },
  });
}
