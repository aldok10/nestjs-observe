import { OptionalPeerLoader } from '@aldok10/nestjs-observe-core';
import type {
  ErrorAdapterCapabilities,
  ErrorTrackingAdapter,
  ObserveErrorEvent,
} from '@aldok10/nestjs-observe-error-tracking';

export interface HighlightClientLike {
  init?(options: Record<string, unknown>): void;
  consumeError(
    error: Error,
    secureSessionId?: string,
    requestId?: string,
    metadata?: Record<string, string>,
  ): void;
  flush?(): Promise<void>;
  stop?(): Promise<void>;
}

export interface HighlightAdapterOptions {
  readonly client?: HighlightClientLike;
  readonly projectID?: string;
  readonly serviceName?: string;
  readonly environment?: string;
  readonly serviceVersion?: string;
  readonly otlpEndpoint?: string;
}

const HIGHLIGHT_CAPABILITIES: ErrorAdapterCapabilities = {
  exceptions: true,
  messages: false,
  breadcrumbs: false,
  fingerprinting: false,
  tags: true,
  userContext: false,
  traceCorrelation: true,
  transactions: true,
  sessions: true,
  profiling: false,
  deliveryMode: 'sdk-managed',
};

function isHighlightClientLike(value: unknown): value is HighlightClientLike {
  return typeof value === 'object' && value !== null && 'consumeError' in value;
}

function unwrapHighlight(value: unknown): HighlightClientLike | undefined {
  if (isHighlightClientLike(value)) return value;
  if (
    typeof value === 'object' &&
    value !== null &&
    'H' in value &&
    isHighlightClientLike(value.H)
  ) {
    return value.H;
  }
  return undefined;
}

function toError(event: ObserveErrorEvent): Error {
  if (event.exception instanceof Error) return event.exception;
  const err = new Error(event.message);
  err.name = event.name;
  if (event.stack !== undefined) err.stack = event.stack;
  return err;
}

function toStringMetadata(event: ObserveErrorEvent): Record<string, string> {
  const out: Record<string, string> = {};
  if (event.tags !== undefined) {
    for (const [k, v] of Object.entries(event.tags)) out[k] = v;
  }
  if (event.trace?.traceId !== undefined) out['traceId'] = event.trace.traceId;
  if (event.trace?.spanId !== undefined) out['spanId'] = event.trace.spanId;
  if (event.source?.module !== undefined) out['module'] = event.source.module;
  if (event.source?.operation !== undefined) out['operation'] = event.source.operation;
  out['severity'] = event.severity;
  return out;
}

export class HighlightErrorAdapter implements ErrorTrackingAdapter {
  readonly name = 'highlight';
  readonly capabilities = HIGHLIGHT_CAPABILITIES;
  private readonly peerLoader = new OptionalPeerLoader(
    typeof __filename === 'string' ? __filename : import.meta.url,
  );
  private client: HighlightClientLike | undefined;

  constructor(private readonly options: HighlightAdapterOptions) {
    this.client = options.client;
  }

  initialize(): void {
    if (this.client === undefined) {
      const loaded = this.peerLoader.load('@highlight-run/node', 'highlight adapter');
      const unwrapped = unwrapHighlight(loaded);
      if (unwrapped === undefined) {
        throw new Error('Invalid @highlight-run/node exports');
      }
      this.client = unwrapped;
    }

    if (this.options.projectID !== undefined && this.client.init !== undefined) {
      this.client.init({
        projectID: this.options.projectID,
        ...(this.options.serviceName !== undefined
          ? { serviceName: this.options.serviceName }
          : {}),
        ...(this.options.environment !== undefined
          ? { environment: this.options.environment }
          : {}),
        ...(this.options.serviceVersion !== undefined
          ? { serviceVersion: this.options.serviceVersion }
          : {}),
        ...(this.options.otlpEndpoint !== undefined
          ? { otlpEndpoint: this.options.otlpEndpoint }
          : {}),
      });
    }
  }

  capture(event: ObserveErrorEvent): void {
    const client = this.client;
    if (client === undefined) throw new Error('highlight adapter is not initialized');
    const sessionId =
      typeof event.vendorContext?.['secureSessionId'] === 'string'
        ? event.vendorContext['secureSessionId']
        : undefined;
    client.consumeError(
      toError(event),
      sessionId,
      event.context?.requestId,
      toStringMetadata(event),
    );
  }

  async flush(): Promise<void> {
    await this.client?.flush?.();
  }

  async shutdown(): Promise<void> {
    await this.flush();
    await this.client?.stop?.();
  }
}

export function createHighlightAdapter(options: HighlightAdapterOptions): HighlightErrorAdapter {
  return new HighlightErrorAdapter(options);
}
