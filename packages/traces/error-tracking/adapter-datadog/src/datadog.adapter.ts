import { OptionalPeerLoader } from '@aldok10/nestjs-observe-core';
import type {
  ErrorAdapterCapabilities,
  ErrorTrackingAdapter,
  ObserveErrorEvent,
} from '@aldok10/nestjs-observe-error-tracking';

export interface DatadogSpanLike {
  setTag(key: string, value: unknown): this | void;
  finish?(): void;
}

export interface DatadogTracerLike {
  scope(): {
    active(): DatadogSpanLike | null | undefined;
  };
  startSpan?(name: string, options?: Record<string, unknown>): DatadogSpanLike;
}

export interface DatadogAdapterOptions {
  readonly client?: DatadogTracerLike;
  readonly createSpanIfMissing?: boolean;
}

const DATADOG_CAPABILITIES: ErrorAdapterCapabilities = {
  exceptions: true,
  messages: true,
  breadcrumbs: false,
  fingerprinting: false,
  tags: true,
  userContext: true,
  traceCorrelation: true,
  transactions: true,
  sessions: false,
  profiling: false,
  deliveryMode: 'sdk-managed',
};

function isDatadogTracer(value: unknown): value is DatadogTracerLike {
  return typeof value === 'object' && value !== null && 'scope' in value;
}

function toError(event: ObserveErrorEvent): Error {
  if (event.exception instanceof Error) return event.exception;
  const err = new Error(event.message);
  err.name = event.name;
  if (event.stack !== undefined) err.stack = event.stack;
  return err;
}

export class DatadogErrorAdapter implements ErrorTrackingAdapter {
  readonly name = 'datadog';
  readonly capabilities = DATADOG_CAPABILITIES;
  private readonly peerLoader = new OptionalPeerLoader(
    typeof __filename === 'string' ? __filename : import.meta.url,
  );
  private client: DatadogTracerLike | undefined;

  constructor(private readonly options: DatadogAdapterOptions = {}) {
    this.client = options.client;
  }

  initialize(): void {
    if (this.client !== undefined) return;
    const loaded = this.peerLoader.load('dd-trace', 'datadog adapter');
    const unwrapped =
      typeof loaded === 'object' && loaded !== null && 'default' in loaded
        ? loaded.default
        : loaded;
    if (!isDatadogTracer(unwrapped)) {
      throw new Error('Invalid dd-trace exports: missing scope()');
    }
    this.client = unwrapped;
  }

  capture(event: ObserveErrorEvent): void {
    const client = this.client;
    if (client === undefined) throw new Error('datadog adapter is not initialized');

    const active = client.scope().active();
    const createdSpan =
      active === null || active === undefined
        ? this.options.createSpanIfMissing !== false
          ? client.startSpan?.('error.capture')
          : undefined
        : undefined;
    const span = active ?? createdSpan;
    if (span === undefined || span === null) return;

    const err = toError(event);
    span.setTag('error', err);
    span.setTag('error.type', event.name);
    span.setTag('error.msg', event.message);
    if (event.stack !== undefined) span.setTag('error.stack', event.stack);
    span.setTag('error.handled', event.handled);
    span.setTag('error.severity', event.severity);

    if (event.serviceName !== undefined) span.setTag('service', event.serviceName);
    if (event.environment !== undefined) span.setTag('env', event.environment);
    if (event.release !== undefined) span.setTag('version', event.release);
    if (event.context?.requestId !== undefined) span.setTag('request.id', event.context.requestId);
    if (event.user?.id !== undefined) span.setTag('usr.id', event.user.id);
    if (event.job?.queueName !== undefined) span.setTag('job.queue', event.job.queueName);
    if (event.database?.system !== undefined) span.setTag('db.system', event.database.system);
    if (event.tags !== undefined) {
      for (const [k, v] of Object.entries(event.tags)) span.setTag(k, v);
    }

    if (createdSpan !== undefined) {
      createdSpan.finish?.();
    }
  }
}

export function createDatadogAdapter(options: DatadogAdapterOptions = {}): DatadogErrorAdapter {
  return new DatadogErrorAdapter(options);
}
