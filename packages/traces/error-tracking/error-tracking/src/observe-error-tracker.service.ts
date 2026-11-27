import { Injectable } from '@nestjs/common';
import type { ComponentHealth } from '@aldok10/nestjs-observe-core';
import type {
  CaptureErrorInput,
  ErrorBreadcrumb,
  ErrorTrackingDiagnosticsReport,
} from './error-tracking.contracts.js';
import type { ErrorTrackingRuntime } from './error-tracking.runtime.js';

export class ObserveErrorTracker {
  constructor(private readonly runtime: ErrorTrackingRuntime) {}

  captureException(exception: unknown, input?: CaptureErrorInput): Promise<string | undefined> {
    return this.runtime.captureException(exception, input);
  }

  captureMessage(message: string, input?: CaptureErrorInput): Promise<string | undefined> {
    return this.runtime.captureMessage(message, input);
  }

  addBreadcrumb(
    breadcrumb: Omit<ErrorBreadcrumb, 'timestamp'> & { readonly timestamp?: Date },
  ): void {
    this.runtime.addBreadcrumb(breadcrumb);
  }

  flush(timeoutMs?: number): Promise<void> {
    return this.runtime.flush(timeoutMs);
  }

  shutdown(timeoutMs?: number): Promise<void> {
    return this.runtime.shutdown(timeoutMs);
  }

  getDiagnostics(): Promise<ErrorTrackingDiagnosticsReport> {
    return this.runtime.getDiagnostics();
  }

  health(): Promise<ComponentHealth> {
    return this.runtime.health();
  }
}

Injectable()(ObserveErrorTracker);
