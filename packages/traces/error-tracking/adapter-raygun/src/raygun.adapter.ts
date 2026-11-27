import { OptionalPeerLoader } from '@aldok10/nestjs-observe-core';
import type {
  ErrorAdapterCapabilities,
  ErrorTrackingAdapter,
  ObserveErrorEvent,
} from '@aldok10/nestjs-observe-error-tracking';

export interface RaygunClientLike {
  init?(options: Record<string, unknown>): RaygunClientLike;
  send(
    exception: Error | string,
    customData?: Record<string, unknown>,
    callback?: (err: unknown) => void,
    request?: unknown,
    tags?: string[],
  ): void;
  stop?(): void;
}

export interface RaygunAdapterOptions {
  readonly client?: RaygunClientLike;
  readonly apiKey?: string;
  readonly batch?: boolean;
}

const RAYGUN_CAPABILITIES: ErrorAdapterCapabilities = {
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

function isRaygunClient(value: unknown): value is RaygunClientLike {
  return typeof value === 'object' && value !== null && 'send' in value;
}

function isRaygunClientCtor(value: unknown): value is new () => RaygunClientLike {
  return typeof value === 'function';
}

function toError(event: ObserveErrorEvent): Error {
  if (event.exception instanceof Error) return event.exception;
  const err = new Error(event.message);
  err.name = event.name;
  if (event.stack !== undefined) err.stack = event.stack;
  return err;
}

export class RaygunErrorAdapter implements ErrorTrackingAdapter {
  readonly name = 'raygun';
  readonly capabilities = RAYGUN_CAPABILITIES;
  private readonly peerLoader = new OptionalPeerLoader(
    typeof __filename === 'string' ? __filename : import.meta.url,
  );
  private client: RaygunClientLike | undefined;

  constructor(private readonly options: RaygunAdapterOptions) {
    this.client = options.client;
  }

  initialize(): void {
    if (this.client !== undefined) return;
    const loaded = this.peerLoader.load('raygun', 'raygun adapter');
    const unwrapped =
      typeof loaded === 'object' && loaded !== null && 'Client' in loaded
        ? loaded.Client
        : typeof loaded === 'object' && loaded !== null && 'default' in loaded
          ? loaded.default
          : loaded;
    if (isRaygunClient(unwrapped)) {
      this.client = unwrapped;
      return;
    }
    if (!isRaygunClientCtor(unwrapped)) {
      throw new Error('Invalid raygun exports: missing Client');
    }
    const instance = new unwrapped();
    this.client =
      instance.init !== undefined && this.options.apiKey !== undefined
        ? instance.init({
            apiKey: this.options.apiKey,
            batch: this.options.batch ?? true,
            reportUncaughtExceptions: false,
          })
        : instance;
  }

  capture(event: ObserveErrorEvent): Promise<void> {
    const client = this.client;
    if (client === undefined) throw new Error('raygun adapter is not initialized');

    const tags: string[] = [
      `severity:${event.severity}`,
      ...(event.tags !== undefined ? Object.entries(event.tags).map(([k, v]) => `${k}:${v}`) : []),
    ];

    const customData: Record<string, unknown> = {
      ...(event.context !== undefined ? { context: event.context } : {}),
      ...(event.trace !== undefined ? { trace: event.trace } : {}),
      ...(event.user !== undefined ? { user: event.user } : {}),
      ...(event.attributes !== undefined ? { attributes: event.attributes } : {}),
    };

    return new Promise((resolve, reject) => {
      client.send(
        toError(event),
        customData,
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
        event.vendorContext?.['request'],
        tags,
      );
    });
  }

  shutdown(): Promise<void> {
    this.client?.stop?.();
    return Promise.resolve();
  }
}

export function createRaygunAdapter(options: RaygunAdapterOptions): RaygunErrorAdapter {
  return new RaygunErrorAdapter(options);
}
