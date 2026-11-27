import { OptionalPeerLoader } from '@aldok10/nestjs-observe-core';
import type {
  ErrorAdapterCapabilities,
  ErrorTrackingAdapter,
  ObserveErrorEvent,
} from '@aldok10/nestjs-observe-error-tracking';

export interface RollbarClientLike {
  critical?(
    obj: unknown,
    custom?: Record<string, unknown>,
    callback?: (err: unknown) => void,
  ): void;
  error(obj: unknown, custom?: Record<string, unknown>, callback?: (err: unknown) => void): void;
  warning?(obj: unknown, custom?: Record<string, unknown>, callback?: (err: unknown) => void): void;
  info?(obj: unknown, custom?: Record<string, unknown>, callback?: (err: unknown) => void): void;
  wait?(callback: () => void): void;
}

export interface RollbarAdapterOptions {
  readonly client?: RollbarClientLike;
  readonly accessToken?: string;
  readonly environment?: string;
  readonly codeVersion?: string;
}

const ROLLBAR_CAPABILITIES: ErrorAdapterCapabilities = {
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

function isRollbarCtor(
  value: unknown,
): value is new (opts: Record<string, unknown>) => RollbarClientLike {
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

export class RollbarErrorAdapter implements ErrorTrackingAdapter {
  readonly name = 'rollbar';
  readonly capabilities = ROLLBAR_CAPABILITIES;
  private readonly peerLoader = new OptionalPeerLoader(
    typeof __filename === 'string' ? __filename : import.meta.url,
  );
  private client: RollbarClientLike | undefined;

  constructor(private readonly options: RollbarAdapterOptions) {
    this.client = options.client;
  }

  initialize(): void {
    if (this.client !== undefined) return;
    const loaded = this.peerLoader.load('rollbar', 'rollbar adapter');
    const Ctor =
      typeof loaded === 'object' && loaded !== null && 'default' in loaded
        ? loaded.default
        : loaded;
    if (!isRollbarCtor(Ctor)) {
      throw new Error('Invalid rollbar package exports');
    }
    this.client = new Ctor({
      accessToken: this.options.accessToken,
      ...(this.options.environment !== undefined ? { environment: this.options.environment } : {}),
      ...(this.options.codeVersion !== undefined ? { codeVersion: this.options.codeVersion } : {}),
      captureUncaught: false,
      captureUnhandledRejections: false,
    });
  }

  capture(event: ObserveErrorEvent): Promise<void> {
    const client = this.client;
    if (client === undefined) throw new Error('rollbar adapter is not initialized');

    const payload = toErrorOrMessage(event);
    const custom: Record<string, unknown> = {
      ...(event.tags !== undefined ? { tags: event.tags } : {}),
      ...(event.trace !== undefined ? { trace: event.trace } : {}),
      ...(event.context !== undefined ? { context: event.context } : {}),
      ...(event.attributes !== undefined ? { attributes: event.attributes } : {}),
      ...(event.fingerprint !== undefined ? { fingerprint: event.fingerprint.join(':') } : {}),
    };

    const method =
      event.severity === 'fatal' && client.critical !== undefined
        ? client.critical.bind(client)
        : event.severity === 'warning' && client.warning !== undefined
          ? client.warning.bind(client)
          : event.severity === 'info' && client.info !== undefined
            ? client.info.bind(client)
            : client.error.bind(client);

    return new Promise((resolve, reject) => {
      method(payload, custom, (err) => {
        if (err !== undefined && err !== null) {
          reject(
            err instanceof Error
              ? err
              : new Error(typeof err === 'string' ? err : JSON.stringify(err)),
          );
          return;
        }
        resolve();
      });
    });
  }

  flush(): Promise<void> {
    if (this.client?.wait === undefined) return Promise.resolve();
    const wait = this.client.wait.bind(this.client);
    return new Promise((resolve) => {
      wait(() => resolve());
    });
  }
}

export function createRollbarAdapter(options: RollbarAdapterOptions): RollbarErrorAdapter {
  return new RollbarErrorAdapter(options);
}
