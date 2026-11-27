import { OptionalPeerLoader } from '@aldok10/nestjs-observe-core';
import type {
  ErrorAdapterCapabilities,
  ErrorTrackingAdapter,
  ObserveErrorEvent,
} from '@aldok10/nestjs-observe-error-tracking';

export interface SentryScopeLike {
  setLevel?(level: string): void;
  setTags?(tags: Record<string, string>): void;
  setExtras?(extras: Record<string, unknown>): void;
  setUser?(user: Record<string, unknown> | null): void;
  setFingerprint?(fingerprint: string[]): void;
  setContext?(name: string, context: Record<string, unknown> | null): void;
  addBreadcrumb?(breadcrumb: Record<string, unknown>): void;
}

export interface SentryClientLike {
  init?(options: Record<string, unknown>): void;
  withScope?(callback: (scope: SentryScopeLike) => void): void;
  captureException(exception: unknown, hint?: Record<string, unknown>): unknown;
  captureMessage?(message: string, level?: string): unknown;
  flush?(timeoutMs?: number): Promise<boolean>;
  close?(timeoutMs?: number): Promise<boolean>;
}

export interface SentryAdapterOptions {
  readonly client?: SentryClientLike;
  readonly dsn?: string;
  readonly environment?: string;
  readonly release?: string;
  readonly sampleRate?: number;
  readonly tracesSampleRate?: number;
  readonly autoSessionTracking?: boolean;
  readonly sendDefaultPii?: boolean;
  readonly closeClient?: boolean;
}

const SENTRY_CAPABILITIES: ErrorAdapterCapabilities = {
  exceptions: true,
  messages: true,
  breadcrumbs: true,
  fingerprinting: true,
  tags: true,
  userContext: true,
  traceCorrelation: true,
  transactions: true,
  sessions: true,
  profiling: true,
  deliveryMode: 'sdk-managed',
};

function isSentryClientLike(value: unknown): value is SentryClientLike {
  return typeof value === 'object' && value !== null && 'captureException' in value;
}

function reconstructError(event: ObserveErrorEvent): Error {
  if (event.exception instanceof Error) return event.exception;
  const err = new Error(event.message);
  err.name = event.name;
  if (event.stack !== undefined) err.stack = event.stack;
  return err;
}

function populateScope(scope: SentryScopeLike, event: ObserveErrorEvent): void {
  scope.setLevel?.(event.severity);
  if (event.tags !== undefined) scope.setTags?.({ ...event.tags });
  if (event.attributes !== undefined) scope.setExtras?.({ ...event.attributes });
  if (event.user !== undefined) {
    scope.setUser?.({
      ...(event.user.id !== undefined ? { id: event.user.id } : {}),
      ...(event.user.username !== undefined ? { username: event.user.username } : {}),
      ...(event.user.email !== undefined ? { email: event.user.email } : {}),
      ...(event.user.ipAddress !== undefined ? { ip_address: event.user.ipAddress } : {}),
    });
  }
  if (event.fingerprint !== undefined && event.fingerprint.length > 0) {
    scope.setFingerprint?.([...event.fingerprint]);
  }
  if (event.trace !== undefined) {
    scope.setContext?.('trace', {
      ...(event.trace.traceId !== undefined ? { trace_id: event.trace.traceId } : {}),
      ...(event.trace.spanId !== undefined ? { span_id: event.trace.spanId } : {}),
      ...(event.trace.traceFlags !== undefined ? { trace_flags: event.trace.traceFlags } : {}),
    });
  }
  if (event.context !== undefined) {
    scope.setContext?.('observe', { ...event.context });
  }
  if (event.source !== undefined) {
    scope.setContext?.('source', { ...event.source });
  }
  if (event.job !== undefined) {
    scope.setContext?.('job', { ...event.job });
  }
  if (event.database !== undefined) {
    scope.setContext?.('database', { ...event.database });
  }
  for (const crumb of event.breadcrumbs ?? []) {
    scope.addBreadcrumb?.({
      message: crumb.message,
      ...(crumb.category !== undefined ? { category: crumb.category } : {}),
      ...(crumb.level !== undefined ? { level: crumb.level } : {}),
      ...(crumb.data !== undefined ? { data: crumb.data } : {}),
      timestamp: crumb.timestamp.getTime() / 1000,
    });
  }
}

export class SentryErrorAdapter implements ErrorTrackingAdapter {
  readonly name: string;
  readonly capabilities: ErrorAdapterCapabilities;
  private readonly peerLoader = new OptionalPeerLoader(
    typeof __filename === 'string' ? __filename : import.meta.url,
  );
  private client: SentryClientLike | undefined;

  constructor(
    private readonly options: SentryAdapterOptions,
    name = 'sentry',
    capabilities: ErrorAdapterCapabilities = SENTRY_CAPABILITIES,
  ) {
    this.name = name;
    this.capabilities = capabilities;
    this.client = options.client;
  }

  initialize(): void {
    if (this.client === undefined) {
      const loaded = this.peerLoader.load('@sentry/node', `${this.name} adapter`);
      if (!isSentryClientLike(loaded)) {
        throw new Error('Invalid @sentry/node exports: missing captureException');
      }
      this.client = loaded;
    }

    if (this.options.dsn !== undefined && this.client.init !== undefined) {
      this.client.init({
        dsn: this.options.dsn,
        ...(this.options.environment !== undefined
          ? { environment: this.options.environment }
          : {}),
        ...(this.options.release !== undefined ? { release: this.options.release } : {}),
        ...(this.options.sampleRate !== undefined ? { sampleRate: this.options.sampleRate } : {}),
        ...(this.options.tracesSampleRate !== undefined
          ? { tracesSampleRate: this.options.tracesSampleRate }
          : {}),
        ...(this.options.autoSessionTracking !== undefined
          ? { autoSessionTracking: this.options.autoSessionTracking }
          : {}),
        ...(this.options.sendDefaultPii !== undefined
          ? { sendDefaultPii: this.options.sendDefaultPii }
          : {}),
      });
    }
  }

  capture(event: ObserveErrorEvent): void {
    const client = this.client;
    if (client === undefined) {
      throw new Error(`${this.name} adapter is not initialized`);
    }

    const send = (): void => {
      if (
        event.name === 'Message' &&
        event.exception === undefined &&
        client.captureMessage !== undefined
      ) {
        client.captureMessage(event.message, event.severity);
      } else {
        client.captureException(reconstructError(event));
      }
    };

    if (client.withScope !== undefined) {
      client.withScope((scope) => {
        populateScope(scope, event);
        send();
      });
    } else {
      send();
    }
  }

  async flush(timeoutMs = 2000): Promise<void> {
    await this.client?.flush?.(timeoutMs);
  }

  async shutdown(timeoutMs = 2000): Promise<void> {
    await this.flush(timeoutMs);
    if (this.options.closeClient !== false) {
      await this.client?.close?.(timeoutMs);
    }
  }
}

export function createSentryAdapter(options: SentryAdapterOptions): SentryErrorAdapter {
  return new SentryErrorAdapter(options);
}
