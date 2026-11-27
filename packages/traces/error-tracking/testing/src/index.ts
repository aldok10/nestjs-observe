import {
  ErrorTrackingRuntime,
  ObserveErrorTracker,
  type ErrorAdapterCapabilities,
  type ErrorTrackingAdapter,
  type ErrorTrackingOptions,
  type ObserveErrorEvent,
} from '@aldok10/nestjs-observe-error-tracking';

const MEMORY_CAPABILITIES: ErrorAdapterCapabilities = {
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
  deliveryMode: 'core-managed',
};

export interface MemoryErrorAdapterOptions {
  readonly name?: string;
  readonly failOnCapture?: boolean;
}

export class MemoryErrorTrackingAdapter implements ErrorTrackingAdapter {
  readonly name: string;
  readonly capabilities = MEMORY_CAPABILITIES;
  readonly events: ObserveErrorEvent[] = [];
  private failOnCapture: boolean;

  constructor(options: MemoryErrorAdapterOptions = {}) {
    this.name = options.name ?? 'memory';
    this.failOnCapture = options.failOnCapture ?? false;
  }

  setFailOnCapture(fail: boolean): void {
    this.failOnCapture = fail;
  }

  capture(event: ObserveErrorEvent): void {
    if (this.failOnCapture) {
      throw new Error(`Simulated failure in ${this.name}`);
    }
    this.events.push(event);
  }

  clear(): void {
    this.events.length = 0;
  }
}

export function createTestErrorTracker(options: Omit<ErrorTrackingOptions, 'destinations'> = {}): {
  adapter: MemoryErrorTrackingAdapter;
  runtime: ErrorTrackingRuntime;
  tracker: ObserveErrorTracker;
} {
  const adapter = new MemoryErrorTrackingAdapter();
  const runtime = new ErrorTrackingRuntime({
    ...options,
    destinations: [{ name: 'memory', adapter }],
  });
  const tracker = new ObserveErrorTracker(runtime);
  return { adapter, runtime, tracker };
}
