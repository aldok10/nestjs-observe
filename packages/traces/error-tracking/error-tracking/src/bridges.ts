import type {
  CaptureErrorInput,
  ErrorSeverity,
  ErrorTraceContext,
} from './error-tracking.contracts.js';
import type { ObserveErrorTracker } from './observe-error-tracker.service.js';

export interface LogRecordLike {
  readonly level: string;
  readonly message: string;
  readonly context?: string;
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly tenantId?: string;
  readonly traceId?: string;
  readonly spanId?: string;
  readonly attributes?: Readonly<Record<string, unknown>>;
  readonly error?: {
    readonly name: string;
    readonly message: string;
    readonly stack?: string;
  };
}

export interface LogTransportBridgeOptions {
  readonly minSeverity?: ErrorSeverity;
  readonly channels?: readonly string[];
  readonly excludeChannels?: readonly string[];
}

const LOG_SEVERITY_MAP: Record<string, ErrorSeverity> = {
  fatal: 'fatal',
  error: 'error',
  warn: 'warning',
  warning: 'warning',
  info: 'info',
  log: 'info',
};

const SEVERITY_ORDER: Record<ErrorSeverity, number> = {
  info: 1,
  warning: 2,
  error: 3,
  fatal: 4,
};

export function createErrorTrackingLogTransport(
  tracker: ObserveErrorTracker,
  options: LogTransportBridgeOptions = {},
): {
  readonly name: string;
  write(record: LogRecordLike): void;
  flush(timeoutMs?: number): Promise<void>;
  close(timeoutMs?: number): Promise<void>;
} {
  const minRank = SEVERITY_ORDER[options.minSeverity ?? 'error'];

  return {
    name: 'error-tracking-bridge',
    write(record: LogRecordLike): void {
      const severity = LOG_SEVERITY_MAP[record.level] ?? 'info';
      if (SEVERITY_ORDER[severity] < minRank) return;

      if (
        options.channels !== undefined &&
        options.channels.length > 0 &&
        (record.context === undefined || !options.channels.includes(record.context))
      ) {
        return;
      }

      if (
        options.excludeChannels !== undefined &&
        record.context !== undefined &&
        options.excludeChannels.includes(record.context)
      ) {
        return;
      }

      const input: CaptureErrorInput = {
        severity,
        handled: true,
        ...(record.context !== undefined ? { source: { module: record.context } } : {}),
        context: {
          ...(record.requestId !== undefined ? { requestId: record.requestId } : {}),
          ...(record.correlationId !== undefined ? { correlationId: record.correlationId } : {}),
          ...(record.tenantId !== undefined ? { tenantId: record.tenantId } : {}),
        },
        ...(record.traceId !== undefined || record.spanId !== undefined
          ? {
              trace: {
                ...(record.traceId !== undefined ? { traceId: record.traceId } : {}),
                ...(record.spanId !== undefined ? { spanId: record.spanId } : {}),
              },
            }
          : {}),
        ...(record.attributes !== undefined ? { attributes: record.attributes } : {}),
      };

      if (record.error !== undefined) {
        const reconstructed = new Error(record.error.message);
        reconstructed.name = record.error.name;
        if (record.error.stack !== undefined) reconstructed.stack = record.error.stack;
        void tracker.captureException(reconstructed, input);
      } else {
        void tracker.captureMessage(record.message, input);
      }
    },
    flush: (timeoutMs?: number) => tracker.flush(timeoutMs),
    close: (timeoutMs?: number) => tracker.shutdown(timeoutMs),
  };
}

export interface SpanLike {
  recordException?(exception: unknown): void;
  setStatus?(status: { code: number; message?: string }): void;
  spanContext?(): {
    readonly traceId?: string;
    readonly spanId?: string;
    readonly traceFlags?: number;
  };
}

export function createTracingErrorBridge(tracker: ObserveErrorTracker): {
  recordAndCaptureException(
    span: SpanLike | undefined,
    error: unknown,
    input?: CaptureErrorInput,
  ): Promise<string | undefined>;
} {
  return {
    async recordAndCaptureException(
      span: SpanLike | undefined,
      error: unknown,
      input: CaptureErrorInput = {},
    ): Promise<string | undefined> {
      const normalized = error instanceof Error ? error : new Error(String(error));
      span?.recordException?.(normalized);
      span?.setStatus?.({ code: 2, message: normalized.message });

      const spanCtx = span?.spanContext?.();
      const trace: ErrorTraceContext | undefined =
        spanCtx?.traceId !== undefined
          ? {
              traceId: spanCtx.traceId,
              ...(spanCtx.spanId !== undefined ? { spanId: spanCtx.spanId } : {}),
              ...(spanCtx.traceFlags !== undefined ? { traceFlags: spanCtx.traceFlags } : {}),
            }
          : input.trace;

      return await tracker.captureException(error, {
        ...input,
        ...(trace !== undefined ? { trace } : {}),
      });
    },
  };
}
