import { Injectable } from '@nestjs/common';
import type { ObserveContextStore } from '@aldok10/nestjs-observe-core';
import type { ObserveErrorTracker } from '@aldok10/nestjs-observe-error-tracking';
import type { UniversalLogger } from '@aldok10/nestjs-observe-logger';
import type { ObserveMetrics } from '@aldok10/nestjs-observe-metrics';
import type { ObserveTracer } from '@aldok10/nestjs-observe-tracing';
import type { ObserverHealthReport } from './observer.contracts.js';
import type { ObserverRuntime } from './observer.runtime.js';

export class ObserverService {
  constructor(private readonly runtime: ObserverRuntime) {}

  get logger(): UniversalLogger | undefined {
    return this.runtime.logger;
  }

  get tracer(): ObserveTracer | undefined {
    return this.runtime.tracer;
  }

  get metrics(): ObserveMetrics | undefined {
    return this.runtime.metrics;
  }

  get errorTracker(): ObserveErrorTracker | undefined {
    return this.runtime.errorTracker;
  }

  get context(): ObserveContextStore {
    return this.runtime.contextStore;
  }

  flush(timeoutMs?: number): Promise<void> {
    return this.runtime.flush(timeoutMs);
  }

  shutdown(timeoutMs?: number): Promise<void> {
    return this.runtime.shutdown(timeoutMs);
  }

  health(): Promise<ObserverHealthReport> {
    return this.runtime.health();
  }
}

Injectable()(ObserverService);
