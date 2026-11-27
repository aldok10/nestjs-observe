import { OptionalPeerLoader } from '@aldok10/nestjs-observe-core';
import type {
  ErrorAdapterCapabilities,
  ErrorTrackingAdapter,
  ObserveErrorEvent,
} from '@aldok10/nestjs-observe-error-tracking';

export interface HoneybadgerClientLike {
  configure?(options: Record<string, unknown>): unknown;
  notifyAsync?(error: unknown, notice?: Record<string, unknown>): Promise<unknown>;
  notify(error: unknown, notice?: Record<string, unknown>): unknown;
  addBreadcrumb?(message: string, opts?: Record<string, unknown>): unknown;
}

export interface HoneybadgerAdapterOptions {
  readonly client?: HoneybadgerClientLike;
  readonly apiKey?: string;
  readonly environment?: string;
  readonly revision?: string;
}

const HONEYBADGER_CAPABILITIES: ErrorAdapterCapabilities = {
  exceptions: true,
  messages: true,
  breadcrumbs: true,
  fingerprinting: true,
  tags: true,
  userContext: true,
  traceCorrelation: true,
  transactions: false,
  sessions: false,
  profiling: false,
  deliveryMode: 'sdk-managed',
};

function isHoneybadgerClient(value: unknown): value is HoneybadgerClientLike {
  return typeof value === 'object' && value !== null && 'notify' in value;
}

function toError(event: ObserveErrorEvent): Error | string {
  if (event.exception instanceof Error) return event.exception;
  if (event.name === 'Message') return event.message;
  const err = new Error(event.message);
  err.name = event.name;
  if (event.stack !== undefined) err.stack = event.stack;
  return err;
}

export class HoneybadgerErrorAdapter implements ErrorTrackingAdapter {
  readonly name = 'honeybadger';
  readonly capabilities = HONEYBADGER_CAPABILITIES;
  private readonly peerLoader = new OptionalPeerLoader(
    typeof __filename === 'string' ? __filename : import.meta.url,
  );
  private client: HoneybadgerClientLike | undefined;

  constructor(private readonly options: HoneybadgerAdapterOptions) {
    this.client = options.client;
  }

  initialize(): void {
    if (this.client === undefined) {
      const loaded = this.peerLoader.load('@honeybadger-io/js', 'honeybadger adapter');
      const unwrapped =
        typeof loaded === 'object' && loaded !== null && 'default' in loaded
          ? loaded.default
          : loaded;
      if (!isHoneybadgerClient(unwrapped)) {
        throw new Error('Invalid @honeybadger-io/js exports');
      }
      this.client = unwrapped;
    }

    if (this.options.apiKey !== undefined && this.client.configure !== undefined) {
      this.client.configure({
        apiKey: this.options.apiKey,
        ...(this.options.environment !== undefined
          ? { environment: this.options.environment }
          : {}),
        ...(this.options.revision !== undefined ? { revision: this.options.revision } : {}),
        enableUncaught: false,
        enableUnhandledRejection: false,
      });
    }
  }

  async capture(event: ObserveErrorEvent): Promise<void> {
    const client = this.client;
    if (client === undefined) throw new Error('honeybadger adapter is not initialized');

    for (const crumb of event.breadcrumbs ?? []) {
      client.addBreadcrumb?.(crumb.message, {
        ...(crumb.category !== undefined ? { category: crumb.category } : {}),
        ...(crumb.data !== undefined ? { metadata: crumb.data } : {}),
      });
    }

    const notice: Record<string, unknown> = {
      ...(event.source?.module !== undefined ? { component: event.source.module } : {}),
      ...(event.source?.operation !== undefined ? { action: event.source.operation } : {}),
      ...(event.fingerprint !== undefined ? { fingerprint: event.fingerprint.join(':') } : {}),
      ...(event.tags !== undefined
        ? { tags: Object.entries(event.tags).map(([k, v]) => `${k}:${v}`) }
        : {}),
      context: {
        ...event.context,
        ...(event.trace !== undefined ? { trace: event.trace } : {}),
        ...(event.user !== undefined
          ? { user_id: event.user.id, user_email: event.user.email }
          : {}),
        ...(event.job !== undefined ? { job: event.job } : {}),
        ...(event.database !== undefined ? { database: event.database } : {}),
        ...(event.attributes !== undefined ? { attributes: event.attributes } : {}),
      },
    };

    const payload = toError(event);
    if (client.notifyAsync !== undefined) {
      await client.notifyAsync(payload, notice);
    } else {
      client.notify(payload, notice);
    }
  }
}

export function createHoneybadgerAdapter(
  options: HoneybadgerAdapterOptions,
): HoneybadgerErrorAdapter {
  return new HoneybadgerErrorAdapter(options);
}
