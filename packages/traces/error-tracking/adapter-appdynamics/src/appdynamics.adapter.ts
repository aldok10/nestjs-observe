import { OptionalPeerLoader } from '@aldok10/nestjs-observe-core';
import type {
  ErrorAdapterCapabilities,
  ErrorTrackingAdapter,
  ObserveErrorEvent,
} from '@aldok10/nestjs-observe-error-tracking';

export interface AppDynamicsTransactionLike {
  markError(error: Error, statusCode?: number): void;
  addSnapshotData?(key: string, value: string): void;
  end?(): void;
}

export interface AppDynamicsAgentLike {
  getTransaction(request: unknown): AppDynamicsTransactionLike | false | undefined;
  startTransaction?(name: string): AppDynamicsTransactionLike;
}

export interface AppDynamicsAdapterOptions {
  readonly client?: AppDynamicsAgentLike;
  readonly startTransactionIfMissing?: boolean;
}

const APPDYNAMICS_CAPABILITIES: ErrorAdapterCapabilities = {
  exceptions: true,
  messages: false,
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

function isAppDynamicsAgent(value: unknown): value is AppDynamicsAgentLike {
  return typeof value === 'object' && value !== null && 'getTransaction' in value;
}

function toError(event: ObserveErrorEvent): Error {
  if (event.exception instanceof Error) return event.exception;
  const err = new Error(event.message);
  err.name = event.name;
  if (event.stack !== undefined) err.stack = event.stack;
  return err;
}

export class AppDynamicsErrorAdapter implements ErrorTrackingAdapter {
  readonly name = 'appdynamics';
  readonly capabilities = APPDYNAMICS_CAPABILITIES;
  private readonly peerLoader = new OptionalPeerLoader(
    typeof __filename === 'string' ? __filename : import.meta.url,
  );
  private client: AppDynamicsAgentLike | undefined;

  constructor(private readonly options: AppDynamicsAdapterOptions = {}) {
    this.client = options.client;
  }

  initialize(): void {
    if (this.client !== undefined) return;
    const loaded = this.peerLoader.load('appdynamics', 'appdynamics adapter');
    const unwrapped =
      typeof loaded === 'object' && loaded !== null && 'default' in loaded
        ? loaded.default
        : loaded;
    if (!isAppDynamicsAgent(unwrapped)) {
      throw new Error('Invalid appdynamics agent exports: missing getTransaction');
    }
    this.client = unwrapped;
  }

  capture(event: ObserveErrorEvent): void {
    const client = this.client;
    if (client === undefined) throw new Error('appdynamics adapter is not initialized');

    const rawRequest = event.vendorContext?.['request'];
    const existing = rawRequest !== undefined ? client.getTransaction(rawRequest) : false;
    const started =
      existing === false || existing === undefined
        ? this.options.startTransactionIfMissing === true
          ? client.startTransaction?.(event.source?.operation ?? event.name)
          : undefined
        : undefined;
    const txn = existing !== false && existing !== undefined ? existing : started;
    if (txn === undefined) return;

    if (event.trace?.traceId !== undefined) txn.addSnapshotData?.('traceId', event.trace.traceId);
    if (event.context?.requestId !== undefined) {
      txn.addSnapshotData?.('requestId', event.context.requestId);
    }
    if (event.tags !== undefined) {
      for (const [k, v] of Object.entries(event.tags)) txn.addSnapshotData?.(k, v);
    }

    txn.markError(toError(event), event.request?.statusCode);

    if (started !== undefined) {
      started.end?.();
    }
  }
}

export function createAppDynamicsAdapter(
  options: AppDynamicsAdapterOptions = {},
): AppDynamicsErrorAdapter {
  return new AppDynamicsErrorAdapter(options);
}
