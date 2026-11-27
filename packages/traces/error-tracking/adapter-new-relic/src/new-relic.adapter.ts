import { OptionalPeerLoader } from '@aldok10/nestjs-observe-core';
import type {
  ErrorAdapterCapabilities,
  ErrorTrackingAdapter,
  ObserveErrorEvent,
} from '@aldok10/nestjs-observe-error-tracking';

export type NewRelicAttributeValue = string | number | boolean;

export interface NewRelicAgentLike {
  noticeError(error: Error, customAttributes?: Record<string, NewRelicAttributeValue>): void;
  addCustomAttributes?(attributes: Record<string, NewRelicAttributeValue>): void;
  shutdown?(
    options: { collectPendingData?: boolean; timeout?: number },
    callback?: (err?: Error) => void,
  ): void;
}

export interface NewRelicAdapterOptions {
  readonly client?: NewRelicAgentLike;
  readonly shutdownAgent?: boolean;
}

const NEW_RELIC_CAPABILITIES: ErrorAdapterCapabilities = {
  exceptions: true,
  messages: true,
  breadcrumbs: false,
  fingerprinting: false,
  tags: true,
  userContext: false,
  traceCorrelation: true,
  transactions: true,
  sessions: false,
  profiling: false,
  deliveryMode: 'sdk-managed',
};

function isNewRelicAgent(value: unknown): value is NewRelicAgentLike {
  return typeof value === 'object' && value !== null && 'noticeError' in value;
}

function toError(event: ObserveErrorEvent): Error {
  if (event.exception instanceof Error) return event.exception;
  const err = new Error(event.message);
  err.name = event.name;
  if (event.stack !== undefined) err.stack = event.stack;
  return err;
}

function toFlatAttributes(event: ObserveErrorEvent): Record<string, NewRelicAttributeValue> {
  const attrs: Record<string, NewRelicAttributeValue> = {
    severity: event.severity,
    handled: event.handled,
  };
  if (event.serviceName !== undefined) attrs['serviceName'] = event.serviceName;
  if (event.environment !== undefined) attrs['environment'] = event.environment;
  if (event.release !== undefined) attrs['release'] = event.release;
  if (event.trace?.traceId !== undefined) attrs['traceId'] = event.trace.traceId;
  if (event.trace?.spanId !== undefined) attrs['spanId'] = event.trace.spanId;
  if (event.context?.requestId !== undefined) attrs['requestId'] = event.context.requestId;
  if (event.context?.correlationId !== undefined) {
    attrs['correlationId'] = event.context.correlationId;
  }
  if (event.source?.module !== undefined) attrs['module'] = event.source.module;
  if (event.source?.operation !== undefined) attrs['operation'] = event.source.operation;
  if (event.job?.queueName !== undefined) attrs['job.queueName'] = event.job.queueName;
  if (event.job?.jobId !== undefined) attrs['job.jobId'] = event.job.jobId;
  if (event.database?.system !== undefined) attrs['db.system'] = event.database.system;
  if (event.database?.operation !== undefined) attrs['db.operation'] = event.database.operation;
  if (event.tags !== undefined) {
    for (const [k, v] of Object.entries(event.tags)) attrs[`tag.${k}`] = v;
  }
  return attrs;
}

export class NewRelicErrorAdapter implements ErrorTrackingAdapter {
  readonly name = 'new-relic';
  readonly capabilities = NEW_RELIC_CAPABILITIES;
  private readonly peerLoader = new OptionalPeerLoader(
    typeof __filename === 'string' ? __filename : import.meta.url,
  );
  private client: NewRelicAgentLike | undefined;

  constructor(private readonly options: NewRelicAdapterOptions = {}) {
    this.client = options.client;
  }

  initialize(): void {
    if (this.client !== undefined) return;
    const loaded = this.peerLoader.load('newrelic', 'new-relic adapter');
    const unwrapped =
      typeof loaded === 'object' && loaded !== null && 'default' in loaded
        ? loaded.default
        : loaded;
    if (!isNewRelicAgent(unwrapped)) {
      throw new Error('Invalid newrelic agent exports: missing noticeError');
    }
    this.client = unwrapped;
  }

  capture(event: ObserveErrorEvent): void {
    const client = this.client;
    if (client === undefined) throw new Error('new-relic adapter is not initialized');
    client.noticeError(toError(event), toFlatAttributes(event));
  }

  shutdown(timeoutMs = 2000): Promise<void> {
    if (this.options.shutdownAgent !== true || this.client?.shutdown === undefined) {
      return Promise.resolve();
    }
    const shutdownFn = this.client.shutdown.bind(this.client);
    return new Promise((resolve) => {
      shutdownFn({ collectPendingData: true, timeout: timeoutMs }, () => resolve());
    });
  }
}

export function createNewRelicAdapter(options: NewRelicAdapterOptions = {}): NewRelicErrorAdapter {
  return new NewRelicErrorAdapter(options);
}
