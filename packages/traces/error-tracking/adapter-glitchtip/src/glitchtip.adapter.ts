import { OptionalPeerLoader } from '@aldok10/nestjs-observe-core';
import type {
  ErrorAdapterCapabilities,
  ErrorTrackingAdapter,
  ObserveErrorEvent,
} from '@aldok10/nestjs-observe-error-tracking';

export interface GlitchTipScopeLike {
  setLevel?(level: string): void;
  setTags?(tags: Record<string, string>): void;
  setExtras?(extras: Record<string, unknown>): void;
  setUser?(user: Record<string, unknown> | null): void;
  setFingerprint?(fingerprint: string[]): void;
  setContext?(name: string, context: Record<string, unknown> | null): void;
  addBreadcrumb?(breadcrumb: Record<string, unknown>): void;
}

export interface GlitchTipClientLike {
  init?(options: Record<string, unknown>): void;
  withScope?(callback: (scope: GlitchTipScopeLike) => void): void;
  captureException(exception: unknown): unknown;
  captureMessage?(message: string, level?: string): unknown;
  flush?(timeoutMs?: number): Promise<boolean>;
  close?(timeoutMs?: number): Promise<boolean>;
}

export interface GlitchTipAdapterOptions {
  readonly client?: GlitchTipClientLike;
  readonly dsn?: string;
  readonly environment?: string;
  readonly release?: string;
  readonly sampleRate?: number;
  readonly tracesSampleRate?: number;
  readonly closeClient?: boolean;
}

const GLITCHTIP_CAPABILITIES: ErrorAdapterCapabilities = {
  exceptions: true,
  messages: true,
  breadcrumbs: true,
  fingerprinting: true,
  tags: true,
  userContext: true,
  traceCorrelation: true,
  transactions: true,
  sessions: false,
  profiling: false,
  deliveryMode: 'sdk-managed',
};

function isClientLike(value: unknown): value is GlitchTipClientLike {
  return typeof value === 'object' && value !== null && 'captureException' in value;
}

function toError(event: ObserveErrorEvent): Error {
  if (event.exception instanceof Error) return event.exception;
  const err = new Error(event.message);
  err.name = event.name;
  if (event.stack !== undefined) err.stack = event.stack;
  return err;
}

export class GlitchTipErrorAdapter implements ErrorTrackingAdapter {
  readonly name = 'glitchtip';
  readonly capabilities = GLITCHTIP_CAPABILITIES;
  private readonly peerLoader = new OptionalPeerLoader(
    typeof __filename === 'string' ? __filename : import.meta.url,
  );
  private client: GlitchTipClientLike | undefined;

  constructor(private readonly options: GlitchTipAdapterOptions) {
    this.client = options.client;
  }

  initialize(): void {
    if (this.client === undefined) {
      const loaded = this.peerLoader.load('@sentry/node', 'glitchtip adapter');
      if (!isClientLike(loaded)) {
        throw new Error('Invalid @sentry/node exports for GlitchTip adapter');
      }
      this.client = loaded;
    }

    if (this.options.dsn !== undefined && this.client.init !== undefined) {
      this.client.init({
        dsn: this.options.dsn,
        autoSessionTracking: false,
        sendDefaultPii: false,
        ...(this.options.environment !== undefined
          ? { environment: this.options.environment }
          : {}),
        ...(this.options.release !== undefined ? { release: this.options.release } : {}),
        ...(this.options.sampleRate !== undefined ? { sampleRate: this.options.sampleRate } : {}),
        ...(this.options.tracesSampleRate !== undefined
          ? { tracesSampleRate: this.options.tracesSampleRate }
          : {}),
      });
    }
  }

  capture(event: ObserveErrorEvent): void {
    const client = this.client;
    if (client === undefined) throw new Error('glitchtip adapter is not initialized');

    const send = (): void => {
      if (
        event.name === 'Message' &&
        event.exception === undefined &&
        client.captureMessage !== undefined
      ) {
        client.captureMessage(event.message, event.severity);
      } else {
        client.captureException(toError(event));
      }
    };

    if (client.withScope !== undefined) {
      client.withScope((scope) => {
        scope.setLevel?.(event.severity);
        if (event.tags !== undefined) scope.setTags?.({ ...event.tags });
        if (event.attributes !== undefined) scope.setExtras?.({ ...event.attributes });
        if (event.user !== undefined) scope.setUser?.({ ...event.user });
        if (event.fingerprint !== undefined && event.fingerprint.length > 0) {
          scope.setFingerprint?.([...event.fingerprint]);
        }
        if (event.trace !== undefined) scope.setContext?.('trace', { ...event.trace });
        if (event.context !== undefined) scope.setContext?.('observe', { ...event.context });
        for (const crumb of event.breadcrumbs ?? []) {
          scope.addBreadcrumb?.({
            message: crumb.message,
            ...(crumb.category !== undefined ? { category: crumb.category } : {}),
            ...(crumb.level !== undefined ? { level: crumb.level } : {}),
          });
        }
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

export function createGlitchTipAdapter(options: GlitchTipAdapterOptions): GlitchTipErrorAdapter {
  return new GlitchTipErrorAdapter(options);
}
