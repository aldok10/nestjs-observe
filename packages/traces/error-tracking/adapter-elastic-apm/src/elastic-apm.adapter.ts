import { OptionalPeerLoader } from '@aldok10/nestjs-observe-core';
import type {
  ErrorAdapterCapabilities,
  ErrorTrackingAdapter,
  ObserveErrorEvent,
} from '@aldok10/nestjs-observe-error-tracking';

export interface ElasticApmAgentLike {
  captureError(
    error: Error | string,
    options?: {
      custom?: Record<string, unknown>;
      labels?: Record<string, string | number | boolean>;
      user?: Record<string, unknown>;
      handled?: boolean;
    },
    callback?: () => void,
  ): void;
  flush?(callback?: (err?: Error) => void): void;
}

export interface ElasticApmAdapterOptions {
  readonly client?: ElasticApmAgentLike;
}

const ELASTIC_APM_CAPABILITIES: ErrorAdapterCapabilities = {
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

function isElasticAgent(value: unknown): value is ElasticApmAgentLike {
  return typeof value === 'object' && value !== null && 'captureError' in value;
}

function toErrorOrMessage(event: ObserveErrorEvent): Error | string {
  if (event.exception instanceof Error) return event.exception;
  if (event.name === 'Message') return event.message;
  const err = new Error(event.message);
  err.name = event.name;
  if (event.stack !== undefined) err.stack = event.stack;
  return err;
}

export class ElasticApmErrorAdapter implements ErrorTrackingAdapter {
  readonly name = 'elastic-apm';
  readonly capabilities = ELASTIC_APM_CAPABILITIES;
  private readonly peerLoader = new OptionalPeerLoader(
    typeof __filename === 'string' ? __filename : import.meta.url,
  );
  private client: ElasticApmAgentLike | undefined;

  constructor(options: ElasticApmAdapterOptions = {}) {
    this.client = options.client;
  }

  initialize(): void {
    if (this.client !== undefined) return;
    const loaded = this.peerLoader.load('elastic-apm-node', 'elastic-apm adapter');
    const unwrapped =
      typeof loaded === 'object' && loaded !== null && 'default' in loaded
        ? loaded.default
        : loaded;
    if (!isElasticAgent(unwrapped)) {
      throw new Error('Invalid elastic-apm-node exports: missing captureError');
    }
    this.client = unwrapped;
  }

  capture(event: ObserveErrorEvent): void {
    const client = this.client;
    if (client === undefined) throw new Error('elastic-apm adapter is not initialized');

    const labels: Record<string, string | number | boolean> = {
      severity: event.severity,
      ...event.tags,
    };
    if (event.trace?.traceId !== undefined) labels['traceId'] = event.trace.traceId;
    if (event.trace?.spanId !== undefined) labels['spanId'] = event.trace.spanId;

    client.captureError(toErrorOrMessage(event), {
      handled: event.handled,
      labels,
      ...(event.user !== undefined
        ? {
            user: {
              ...(event.user.id !== undefined ? { id: event.user.id } : {}),
              ...(event.user.username !== undefined ? { username: event.user.username } : {}),
              ...(event.user.email !== undefined ? { email: event.user.email } : {}),
            },
          }
        : {}),
      custom: {
        ...(event.context !== undefined ? { context: event.context } : {}),
        ...(event.job !== undefined ? { job: event.job } : {}),
        ...(event.database !== undefined ? { database: event.database } : {}),
        ...(event.attributes !== undefined ? { attributes: event.attributes } : {}),
      },
    });
  }

  flush(): Promise<void> {
    if (this.client?.flush === undefined) return Promise.resolve();
    const flushFn = this.client.flush.bind(this.client);
    return new Promise((resolve) => {
      flushFn(() => resolve());
    });
  }
}

export function createElasticApmAdapter(
  options: ElasticApmAdapterOptions = {},
): ElasticApmErrorAdapter {
  return new ElasticApmErrorAdapter(options);
}
