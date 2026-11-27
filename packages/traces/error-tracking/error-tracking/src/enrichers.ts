import { hostname as osHostname } from 'node:os';
import {
  tryLoadOptionalPeer,
  type ObserveContextStore,
  type ResourceMetadata,
} from '@aldok10/nestjs-observe-core';
import type {
  ErrorEnricher,
  ErrorTraceContext,
  ObserveErrorEvent,
} from './error-tracking.contracts.js';

interface OtelApiLike {
  context?: { active(): unknown };
  trace?: {
    getSpan(ctx: unknown):
      | {
          spanContext(): {
            traceId?: string;
            spanId?: string;
            traceFlags?: number;
          };
        }
      | undefined;
  };
}

function isOtelApiLike(value: unknown): value is OtelApiLike {
  return typeof value === 'object' && value !== null && 'trace' in value && 'context' in value;
}

export function createApplicationEnricher(resource: ResourceMetadata): ErrorEnricher {
  return {
    name: 'application',
    enrich: (event) => ({
      ...(event.serviceName === undefined && resource.serviceName !== undefined
        ? { serviceName: resource.serviceName }
        : {}),
      ...(event.environment === undefined && resource.environment !== undefined
        ? { environment: resource.environment }
        : {}),
      ...(event.release === undefined && resource.serviceVersion !== undefined
        ? { release: resource.serviceVersion }
        : {}),
      ...(event.instanceId === undefined && resource.serviceInstanceId !== undefined
        ? { instanceId: resource.serviceInstanceId }
        : {}),
    }),
  };
}

export function createDeploymentEnricher(
  options: {
    readonly deployment?: string;
    readonly hostname?: string;
  } = {},
): ErrorEnricher {
  const host = options.hostname ?? osHostname();
  return {
    name: 'deployment',
    enrich: (event) => ({
      ...(event.deployment === undefined && options.deployment !== undefined
        ? { deployment: options.deployment }
        : {}),
      ...(event.hostname === undefined ? { hostname: host } : {}),
    }),
  };
}

export function createContextEnricher(store: ObserveContextStore): ErrorEnricher {
  return {
    name: 'observe-context',
    enrich: (event) => {
      const ctx = store.get();
      return {
        context: {
          ...(ctx.requestId !== undefined ? { requestId: ctx.requestId } : {}),
          ...(ctx.correlationId !== undefined ? { correlationId: ctx.correlationId } : {}),
          ...(ctx.tenantId !== undefined ? { tenantId: ctx.tenantId } : {}),
          ...(ctx.jobId !== undefined ? { jobId: ctx.jobId } : {}),
          ...(ctx.workerId !== undefined ? { workerId: ctx.workerId } : {}),
          ...event.context,
        },
        ...(event.trace === undefined && (ctx.traceId !== undefined || ctx.spanId !== undefined)
          ? {
              trace: {
                ...(ctx.traceId !== undefined ? { traceId: ctx.traceId } : {}),
                ...(ctx.spanId !== undefined ? { spanId: ctx.spanId } : {}),
              },
            }
          : {}),
      };
    },
  };
}

export function createTraceContextEnricher(
  provider?: () => ErrorTraceContext | undefined,
): ErrorEnricher {
  return {
    name: 'trace-context',
    enrich: (event) => {
      if (event.trace?.traceId !== undefined) return undefined;
      if (provider !== undefined) {
        const provided = provider();
        return provided !== undefined && provided.traceId !== undefined
          ? { trace: provided }
          : undefined;
      }
      const otel = tryLoadOptionalPeer('@opentelemetry/api');
      if (!isOtelApiLike(otel)) return undefined;
      const spanCtx = otel.trace?.getSpan(otel.context?.active())?.spanContext();
      if (spanCtx?.traceId === undefined) return undefined;
      return {
        trace: {
          traceId: spanCtx.traceId,
          ...(spanCtx.spanId !== undefined ? { spanId: spanCtx.spanId } : {}),
          ...(spanCtx.traceFlags !== undefined ? { traceFlags: spanCtx.traceFlags } : {}),
        },
      };
    },
  };
}

export async function runEnrichers(
  initial: ObserveErrorEvent,
  enrichers: readonly ErrorEnricher[],
): Promise<ObserveErrorEvent> {
  return await enrichers.reduce<Promise<ObserveErrorEvent>>(async (prevPromise, enricher) => {
    const current = await prevPromise;
    try {
      const patch = await enricher.enrich(current);
      return patch !== undefined ? mergeEventPatch(current, patch) : current;
    } catch {
      // Optional enricher failures must never prevent error reporting.
      return current;
    }
  }, Promise.resolve(initial));
}

function mergeEventPatch(
  current: ObserveErrorEvent,
  patch: Partial<ObserveErrorEvent>,
): ObserveErrorEvent {
  return {
    ...current,
    ...patch,
    ...(current.context !== undefined || patch.context !== undefined
      ? { context: { ...current.context, ...patch.context } }
      : {}),
    ...(current.trace !== undefined || patch.trace !== undefined
      ? { trace: { ...current.trace, ...patch.trace } }
      : {}),
    ...(current.source !== undefined || patch.source !== undefined
      ? { source: { ...current.source, ...patch.source } }
      : {}),
    ...(current.attributes !== undefined || patch.attributes !== undefined
      ? { attributes: { ...current.attributes, ...patch.attributes } }
      : {}),
    ...(current.tags !== undefined || patch.tags !== undefined
      ? { tags: { ...current.tags, ...patch.tags } }
      : {}),
  };
}
