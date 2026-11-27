import { tryLoadOptionalPeer } from '@aldok10/nestjs-observe-core';
import type {
  ErrorAdapterCapabilities,
  ErrorSeverity,
  ErrorTrackingAdapter,
  ObserveErrorEvent,
} from '@aldok10/nestjs-observe-error-tracking';

export interface DynatraceAdapterOptions {
  /** Base Dynatrace environment URL (e.g. https://<env>.live.dynatrace.com) or full OTLP logs URL. */
  readonly endpoint: string;
  readonly apiToken?: string;
  readonly platformToken?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly recordOnActiveSpan?: boolean;
}

const DYNATRACE_CAPABILITIES: ErrorAdapterCapabilities = {
  exceptions: true,
  messages: true,
  breadcrumbs: false,
  fingerprinting: false,
  tags: true,
  userContext: false,
  traceCorrelation: true,
  transactions: true,
  sessions: false,
  profiling: false,
  deliveryMode: 'direct-http',
};

const SEVERITY_MAP: Record<ErrorSeverity, { readonly number: number; readonly text: string }> = {
  info: { number: 9, text: 'INFO' },
  warning: { number: 13, text: 'WARN' },
  error: { number: 17, text: 'ERROR' },
  fatal: { number: 21, text: 'FATAL' },
};

interface OtelApiLike {
  context?: { active(): unknown };
  trace?: {
    getSpan(ctx: unknown):
      | {
          recordException(err: Error): void;
          setStatus(status: { code: number; message?: string }): void;
        }
      | undefined;
  };
}

function isOtelApiLike(value: unknown): value is OtelApiLike {
  return typeof value === 'object' && value !== null && 'trace' in value && 'context' in value;
}

function attr(key: string, value: unknown): Record<string, unknown> {
  if (typeof value === 'boolean') return { key, value: { boolValue: value } };
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { key, value: { intValue: String(value) } }
      : { key, value: { doubleValue: value } };
  }
  return { key, value: { stringValue: typeof value === 'string' ? value : JSON.stringify(value) } };
}

function buildPayload(event: ObserveErrorEvent): Record<string, unknown> {
  const sev = SEVERITY_MAP[event.severity];
  const resourceAttrs: Record<string, unknown>[] = [];
  if (event.serviceName !== undefined) resourceAttrs.push(attr('service.name', event.serviceName));
  if (event.release !== undefined) resourceAttrs.push(attr('service.version', event.release));
  if (event.environment !== undefined) {
    resourceAttrs.push(attr('deployment.environment', event.environment));
  }

  const logAttrs: Record<string, unknown>[] = [
    attr('exception.type', event.name),
    attr('exception.message', event.message),
    attr('error.handled', event.handled),
  ];
  if (event.stack !== undefined) logAttrs.push(attr('exception.stacktrace', event.stack));
  if (event.tags !== undefined) {
    for (const [k, v] of Object.entries(event.tags)) logAttrs.push(attr(`tag.${k}`, v));
  }

  const timeUnixNano = `${BigInt(event.timestamp.getTime()) * 1_000_000n}`;

  return {
    resourceLogs: [
      {
        resource: { attributes: resourceAttrs },
        scopeLogs: [
          {
            scope: { name: '@aldok10/nestjs-observe-error-tracking-dynatrace', version: '0.1.0' },
            logRecords: [
              {
                timeUnixNano,
                severityNumber: sev.number,
                severityText: sev.text,
                body: { stringValue: `${event.name}: ${event.message}` },
                attributes: logAttrs,
                ...(event.trace?.traceId !== undefined ? { traceId: event.trace.traceId } : {}),
                ...(event.trace?.spanId !== undefined ? { spanId: event.trace.spanId } : {}),
              },
            ],
          },
        ],
      },
    ],
  };
}

export class DynatraceErrorAdapter implements ErrorTrackingAdapter {
  readonly name = 'dynatrace';
  readonly capabilities = DYNATRACE_CAPABILITIES;
  private readonly logsUrl: string;

  constructor(private readonly options: DynatraceAdapterOptions) {
    const trimmed = options.endpoint.replace(/\/+$/, '');
    this.logsUrl = trimmed.endsWith('/v1/logs')
      ? trimmed
      : trimmed.endsWith('/api/v2/otlp')
        ? `${trimmed}/v1/logs`
        : `${trimmed}/api/v2/otlp/v1/logs`;
  }

  async capture(event: ObserveErrorEvent, signal?: AbortSignal): Promise<void> {
    if (this.options.recordOnActiveSpan !== false) {
      const otel = tryLoadOptionalPeer('@opentelemetry/api');
      if (isOtelApiLike(otel)) {
        const span = otel.trace?.getSpan(otel.context?.active());
        if (span !== undefined) {
          const err = event.exception instanceof Error ? event.exception : new Error(event.message);
          span.recordException(err);
          span.setStatus({ code: 2, message: event.message });
        }
      }
    }

    const authHeader =
      this.options.platformToken !== undefined
        ? `Bearer ${this.options.platformToken}`
        : this.options.apiToken !== undefined
          ? `Api-Token ${this.options.apiToken}`
          : undefined;

    const controller = new AbortController();
    const timeoutMs = this.options.timeoutMs ?? 3000;
    const timer = setTimeout(
      () => controller.abort(new Error('Dynatrace OTLP timed out')),
      timeoutMs,
    );
    timer.unref();

    const onExternalAbort = (): void => {
      controller.abort(signal?.reason);
    };
    signal?.addEventListener('abort', onExternalAbort, { once: true });

    try {
      const res = await fetch(this.logsUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(authHeader !== undefined ? { authorization: authHeader } : {}),
          ...this.options.headers,
        },
        body: JSON.stringify(buildPayload(event)),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Dynatrace OTLP export failed with HTTP ${res.status}`);
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onExternalAbort);
    }
  }
}

export function createDynatraceAdapter(options: DynatraceAdapterOptions): DynatraceErrorAdapter {
  return new DynatraceErrorAdapter(options);
}
