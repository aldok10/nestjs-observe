import { OptionalPeerLoader } from '@aldok10/nestjs-observe-core';
import type {
  ErrorAdapterCapabilities,
  ErrorTrackingAdapter,
  ObserveErrorEvent,
} from '@aldok10/nestjs-observe-error-tracking';

export interface BugsnagEventLike {
  severity?: 'error' | 'warning' | 'info';
  groupingHash?: string;
  context?: string;
  setUser?(id?: string, email?: string, name?: string): void;
  addMetadata(section: string, values: Record<string, unknown>): void;
}

export interface BugsnagClientLike {
  start?(options: Record<string, unknown>): unknown;
  notify(
    error: Error,
    onError?: (event: BugsnagEventLike) => void,
    callback?: (err: unknown) => void,
  ): void;
  leaveBreadcrumb?(name: string, metadata?: Record<string, unknown>, type?: string): void;
}

export interface BugsnagAdapterOptions {
  readonly client?: BugsnagClientLike;
  readonly apiKey?: string;
  readonly releaseStage?: string;
  readonly appVersion?: string;
}

const BUGSNAG_CAPABILITIES: ErrorAdapterCapabilities = {
  exceptions: true,
  messages: true,
  breadcrumbs: true,
  fingerprinting: true,
  tags: true,
  userContext: true,
  traceCorrelation: true,
  transactions: false,
  sessions: true,
  profiling: false,
  deliveryMode: 'sdk-managed',
};

function isBugsnagClient(value: unknown): value is BugsnagClientLike {
  return typeof value === 'object' && value !== null && 'notify' in value;
}

function toError(event: ObserveErrorEvent): Error {
  if (event.exception instanceof Error) return event.exception;
  const err = new Error(event.message);
  err.name = event.name;
  if (event.stack !== undefined) err.stack = event.stack;
  return err;
}

function mapSeverity(severity: ObserveErrorEvent['severity']): 'error' | 'warning' | 'info' {
  if (severity === 'warning') return 'warning';
  if (severity === 'info') return 'info';
  return 'error';
}

export class BugsnagErrorAdapter implements ErrorTrackingAdapter {
  readonly name = 'bugsnag';
  readonly capabilities = BUGSNAG_CAPABILITIES;
  private readonly peerLoader = new OptionalPeerLoader(
    typeof __filename === 'string' ? __filename : import.meta.url,
  );
  private client: BugsnagClientLike | undefined;

  constructor(private readonly options: BugsnagAdapterOptions) {
    this.client = options.client;
  }

  initialize(): void {
    if (this.client === undefined) {
      const loaded = this.peerLoader.load('@bugsnag/js', 'bugsnag adapter');
      const unwrapped =
        typeof loaded === 'object' && loaded !== null && 'default' in loaded
          ? loaded.default
          : loaded;
      if (!isBugsnagClient(unwrapped)) {
        throw new Error('Invalid @bugsnag/js exports');
      }
      this.client = unwrapped;
    }

    if (this.options.apiKey !== undefined && this.client.start !== undefined) {
      this.client.start({
        apiKey: this.options.apiKey,
        ...(this.options.releaseStage !== undefined
          ? { releaseStage: this.options.releaseStage }
          : {}),
        ...(this.options.appVersion !== undefined ? { appVersion: this.options.appVersion } : {}),
      });
    }
  }

  capture(event: ObserveErrorEvent): Promise<void> {
    const client = this.client;
    if (client === undefined) throw new Error('bugsnag adapter is not initialized');

    for (const crumb of event.breadcrumbs ?? []) {
      client.leaveBreadcrumb?.(crumb.message, crumb.data ? { ...crumb.data } : undefined);
    }

    return new Promise((resolve, reject) => {
      client.notify(
        toError(event),
        (bsEvent) => {
          bsEvent.severity = mapSeverity(event.severity);
          if (event.fingerprint !== undefined && event.fingerprint.length > 0) {
            bsEvent.groupingHash = event.fingerprint.join(':');
          }
          if (event.source?.operation !== undefined) {
            bsEvent.context = event.source.operation;
          }
          if (event.user !== undefined) {
            bsEvent.setUser?.(event.user.id, event.user.email, event.user.username);
          }
          if (event.tags !== undefined) bsEvent.addMetadata('tags', { ...event.tags });
          if (event.trace !== undefined) bsEvent.addMetadata('trace', { ...event.trace });
          if (event.context !== undefined) bsEvent.addMetadata('observe', { ...event.context });
          if (event.attributes !== undefined)
            bsEvent.addMetadata('attributes', { ...event.attributes });
        },
        (err) => {
          if (err !== undefined && err !== null) {
            reject(
              err instanceof Error
                ? err
                : new Error(typeof err === 'string' ? err : JSON.stringify(err)),
            );
            return;
          }
          resolve();
        },
      );
    });
  }
}

export function createBugsnagAdapter(options: BugsnagAdapterOptions): BugsnagErrorAdapter {
  return new BugsnagErrorAdapter(options);
}
