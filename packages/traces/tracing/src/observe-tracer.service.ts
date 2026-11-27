import { Injectable } from '@nestjs/common';
import {
  SpanStatusCode,
  context,
  propagation,
  trace,
  type Attributes,
  type AttributeValue,
  type Context,
  type Span,
  type Tracer,
} from '@opentelemetry/api';
import type { SpanOptions, TraceContextSnapshot } from './tracing.contracts.js';
import type { TracingRuntime } from './tracing.runtime.js';

export class ObserveTracer {
  constructor(private readonly runtime: TracingRuntime) {}

  getTracer(name?: string, version?: string): Tracer {
    return this.runtime.getTracer(name, version);
  }

  getActiveSpan(): Span | undefined {
    return trace.getSpan(context.active());
  }

  getTraceContext(): TraceContextSnapshot {
    const spanContext = this.getActiveSpan()?.spanContext();
    if (spanContext === undefined) return {};
    return {
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
      traceFlags: spanContext.traceFlags,
    };
  }

  startSpan(name: string, options: SpanOptions = {}, parentContext?: Context): Span {
    return this.getTracer().startSpan(
      name,
      {
        ...(options.kind !== undefined ? { kind: options.kind } : {}),
        ...(options.attributes !== undefined ? { attributes: options.attributes } : {}),
        ...(options.links !== undefined ? { links: [...options.links] } : {}),
      },
      parentContext ?? context.active(),
    );
  }

  async withSpan<T>(
    name: string,
    fn: (span: Span) => Promise<T> | T,
    options: SpanOptions = {},
  ): Promise<T> {
    const tracer = this.getTracer();
    return await tracer.startActiveSpan(
      name,
      {
        ...(options.kind !== undefined ? { kind: options.kind } : {}),
        ...(options.attributes !== undefined ? { attributes: options.attributes } : {}),
        ...(options.links !== undefined ? { links: [...options.links] } : {}),
      },
      async (span) => {
        try {
          const result = await fn(span);
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (error: unknown) {
          this.recordExceptionOnSpan(span, error);
          throw error;
        } finally {
          span.end();
        }
      },
    );
  }

  setAttributes(attributes: Attributes): void {
    this.getActiveSpan()?.setAttributes(attributes);
  }

  setAttribute(key: string, value: AttributeValue): void {
    this.getActiveSpan()?.setAttribute(key, value);
  }

  addEvent(name: string, attributes?: Attributes): void {
    this.getActiveSpan()?.addEvent(name, attributes);
  }

  recordException(error: unknown): void {
    const span = this.getActiveSpan();
    if (span !== undefined) this.recordExceptionOnSpan(span, error);
  }

  withBaggage<T>(entries: Readonly<Record<string, string>>, fn: () => T): T {
    let baggage = propagation.getBaggage(context.active()) ?? propagation.createBaggage();
    for (const [key, value] of Object.entries(entries)) {
      baggage = baggage.setEntry(key, { value });
    }
    const nextContext = propagation.setBaggage(context.active(), baggage);
    return context.with(nextContext, fn);
  }

  getBaggageEntry(key: string): string | undefined {
    return propagation.getBaggage(context.active())?.getEntry(key)?.value;
  }

  private recordExceptionOnSpan(span: Span, error: unknown): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    span.recordException(normalized);
    span.setStatus({ code: SpanStatusCode.ERROR, message: normalized.message });
  }
}

Injectable()(ObserveTracer);
