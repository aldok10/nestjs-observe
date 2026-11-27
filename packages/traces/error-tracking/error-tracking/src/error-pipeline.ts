import type {
  ErrorDeduplicationOptions,
  ErrorFilter,
  ErrorSamplingOptions,
  ErrorSeverity,
  ObserveErrorEvent,
} from './error-tracking.contracts.js';

const SEVERITY_RANK: Record<ErrorSeverity, number> = {
  info: 1,
  warning: 2,
  error: 3,
  fatal: 4,
};

export function matchesErrorFilter(
  event: ObserveErrorEvent,
  filter: ErrorFilter | undefined,
): boolean {
  if (filter === undefined) return true;
  if (typeof filter === 'function') return filter(event);

  if (
    filter.minSeverity !== undefined &&
    SEVERITY_RANK[event.severity] < SEVERITY_RANK[filter.minSeverity]
  ) {
    return false;
  }

  if (
    filter.environments !== undefined &&
    filter.environments.length > 0 &&
    (event.environment === undefined || !filter.environments.includes(event.environment))
  ) {
    return false;
  }

  if (
    filter.modules !== undefined &&
    filter.modules.length > 0 &&
    (event.source?.module === undefined || !filter.modules.includes(event.source.module))
  ) {
    return false;
  }

  if (filter.ignoreErrors !== undefined) {
    for (const pattern of filter.ignoreErrors) {
      if (typeof pattern === 'string') {
        if (event.name === pattern || event.message.includes(pattern)) return false;
      } else if (pattern.test(event.name) || pattern.test(event.message)) {
        return false;
      }
    }
  }

  if (filter.predicate !== undefined && !filter.predicate(event)) {
    return false;
  }

  return true;
}

export function shouldSampleEvent(
  event: ObserveErrorEvent,
  sampling: ErrorSamplingOptions | undefined,
): boolean {
  if (sampling === undefined || sampling.rate === undefined) return true;
  if (sampling.rate >= 1) return true;
  if (event.severity === 'fatal' && sampling.sampleFatal !== true) return true;
  if (sampling.rate <= 0) return false;
  const roll = (sampling.random ?? Math.random)();
  return roll < sampling.rate;
}

export class ErrorDeduplicator {
  private readonly seenExceptions = new WeakSet<object>();
  private readonly recentSignatures = new Map<string, number>();
  private readonly enabled: boolean;
  private readonly windowMs: number;
  private readonly maxEntries: number;

  constructor(options: ErrorDeduplicationOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.windowMs = options.windowMs ?? 5000;
    this.maxEntries = options.maxEntries ?? 1000;
  }

  isDuplicate(event: ObserveErrorEvent, now: number = Date.now()): boolean {
    if (!this.enabled) return false;

    if (typeof event.exception === 'object' && event.exception !== null) {
      if (this.seenExceptions.has(event.exception)) {
        return true;
      }
      this.seenExceptions.add(event.exception);
    }

    if (this.windowMs <= 0) return false;

    const signature = this.buildSignature(event);
    const expiresAt = this.recentSignatures.get(signature);
    if (expiresAt !== undefined && expiresAt > now) {
      return true;
    }

    if (this.recentSignatures.size >= this.maxEntries) {
      this.evictExpired(now);
      if (this.recentSignatures.size >= this.maxEntries) {
        const oldestKey = this.recentSignatures.keys().next().value;
        if (oldestKey !== undefined) this.recentSignatures.delete(oldestKey);
      }
    }

    this.recentSignatures.set(signature, now + this.windowMs);
    return false;
  }

  clear(): void {
    this.recentSignatures.clear();
  }

  private buildSignature(event: ObserveErrorEvent): string {
    if (event.fingerprint !== undefined && event.fingerprint.length > 0) {
      return `fp:${event.fingerprint.join('|')}`;
    }
    const topFrame = event.stack?.split('\n')[1]?.trim() ?? '';
    return `${event.name}:${event.message}:${topFrame}`;
  }

  private evictExpired(now: number): void {
    for (const [key, expiresAt] of this.recentSignatures.entries()) {
      if (expiresAt <= now) this.recentSignatures.delete(key);
    }
  }
}
