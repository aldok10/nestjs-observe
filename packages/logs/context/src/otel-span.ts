import { createRequire } from 'node:module';
import type { LogContext } from '@aldok10/nestjs-observe-logger-core/contracts';
import type * as OtelApiTypes from '@opentelemetry/api';

// Optional peer: resolve on first use so importing this package never requires OTel.
// CJS builds erase import.meta.url, so use __filename there.
const requireModule = createRequire(typeof __filename === 'string' ? __filename : import.meta.url);
type OtelApi = typeof OtelApiTypes;
let cachedApi: OtelApi | undefined;
function isOtelApi(value: unknown): value is OtelApi {
  return typeof value === 'object' && value !== null && 'trace' in value;
}

function loadOtelApi(): OtelApi | undefined {
  if (cachedApi === undefined) {
    try {
      const loaded: unknown = requireModule('@opentelemetry/api');
      if (isOtelApi(loaded)) cachedApi = loaded;
    } catch {
      return undefined;
    }
  }
  return cachedApi;
}

interface ActiveSpanLike {
  spanContext?(): { traceId?: string; spanId?: string } | undefined;
}

/**
 * Reads trace correlation from the active OpenTelemetry span.
 * This package never starts spans or registers an SDK.
 */
export function fromActiveSpan(): LogContext {
  try {
    const api = loadOtelApi();
    if (api === undefined) return {};
    const span = api.trace.getSpan(api.context.active()) as ActiveSpanLike | undefined;
    const spanContext = span?.spanContext?.();
    if (spanContext === undefined) return {};
    return {
      ...(spanContext.traceId !== undefined ? { traceId: spanContext.traceId } : {}),
      ...(spanContext.spanId !== undefined ? { spanId: spanContext.spanId } : {}),
    };
  } catch {
    return {};
  }
}

/** Provider for `new LogContextStore({ activeSpanProvider })`. */
export function createActiveSpanProvider(): () => LogContext {
  return fromActiveSpan;
}

/** Merges active-span fields under explicit context so callers keep precedence. */
export function withActiveSpan(context: LogContext = {}): LogContext {
  return { ...fromActiveSpan(), ...context };
}
