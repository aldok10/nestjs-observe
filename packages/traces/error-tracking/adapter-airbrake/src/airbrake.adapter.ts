import { OptionalPeerLoader } from '@aldok10/nestjs-observe-core';
import type {
  ErrorAdapterCapabilities,
  ErrorTrackingAdapter,
  ObserveErrorEvent,
} from '@aldok10/nestjs-observe-error-tracking';

export interface AirbrakeClientLike {
  notify(notice: unknown): Promise<unknown>;
  close?(): Promise<void> | void;
}

export interface AirbrakeAdapterOptions {
  readonly client?: AirbrakeClientLike;
  readonly projectId?: number;
  readonly projectKey?: string;
  readonly environment?: string;
}

const AIRBRAKE_CAPABILITIES: ErrorAdapterCapabilities = {
  exceptions: true,
  messages: true,
  breadcrumbs: false,
  fingerprinting: false,
  tags: true,
  userContext: true,
  traceCorrelation: true,
  transactions: false,
  sessions: false,
  profiling: false,
  deliveryMode: 'sdk-managed',
};

function isAirbrakeClient(value: unknown): value is AirbrakeClientLike {
  return typeof value === 'object' && value !== null && 'notify' in value;
}

function isNotifierCtor(
  value: unknown,
): value is new (opts: Record<string, unknown>) => AirbrakeClientLike {
  return typeof value === 'function';
}

function toErrorOrMessage(event: ObserveErrorEvent): Error | string {
  if (event.exception instanceof Error) return event.exception;
  if (event.name === 'Message') return event.message;
  const err = new Error(event.message);
  err.name = event.name;
  if (event.stack !== undefined) err.stack = event.stack;
  return err;
}

export class AirbrakeErrorAdapter implements ErrorTrackingAdapter {
  readonly name = 'airbrake';
  readonly capabilities = AIRBRAKE_CAPABILITIES;
  private readonly peerLoader = new OptionalPeerLoader(
    typeof __filename === 'string' ? __filename : import.meta.url,
  );
  private client: AirbrakeClientLike | undefined;

  constructor(private readonly options: AirbrakeAdapterOptions) {
    this.client = options.client;
  }

  initialize(): void {
    if (this.client !== undefined) return;
    const loaded = this.peerLoader.load('@airbrake/node', 'airbrake adapter');
    const notifierExport =
      typeof loaded === 'object' && loaded !== null && 'Notifier' in loaded
        ? loaded.Notifier
        : loaded;
    if (isAirbrakeClient(notifierExport)) {
      this.client = notifierExport;
      return;
    }
    if (!isNotifierCtor(notifierExport)) {
      throw new Error('Invalid @airbrake/node exports: missing Notifier');
    }
    this.client = new notifierExport({
      projectId: this.options.projectId,
      projectKey: this.options.projectKey,
      ...(this.options.environment !== undefined ? { environment: this.options.environment } : {}),
    });
  }

  async capture(event: ObserveErrorEvent): Promise<void> {
    const client = this.client;
    if (client === undefined) throw new Error('airbrake adapter is not initialized');

    await client.notify({
      error: toErrorOrMessage(event),
      context: {
        severity: event.severity,
        ...(event.environment !== undefined ? { environment: event.environment } : {}),
        ...(event.release !== undefined ? { version: event.release } : {}),
        ...(event.source?.module !== undefined ? { component: event.source.module } : {}),
        ...(event.source?.operation !== undefined ? { action: event.source.operation } : {}),
        ...(event.user !== undefined ? { user: event.user } : {}),
      },
      params: {
        ...(event.context !== undefined ? { context: event.context } : {}),
        ...(event.trace !== undefined ? { trace: event.trace } : {}),
        ...(event.tags !== undefined ? { tags: event.tags } : {}),
        ...(event.attributes !== undefined ? { attributes: event.attributes } : {}),
      },
    });
  }

  async shutdown(): Promise<void> {
    await this.client?.close?.();
  }
}

export function createAirbrakeAdapter(options: AirbrakeAdapterOptions): AirbrakeErrorAdapter {
  return new AirbrakeErrorAdapter(options);
}
