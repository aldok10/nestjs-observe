import { SpanStatusCode, trace, type Span } from '@opentelemetry/api';
import type { TraceDecoratorOptions } from './tracing.contracts.js';

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    'then' in value &&
    typeof value.then === 'function'
  );
}

function failSpan(span: Span, error: unknown, recordException: boolean): void {
  const normalized = error instanceof Error ? error : new Error(String(error));
  if (recordException) span.recordException(normalized);
  span.setStatus({ code: SpanStatusCode.ERROR, message: normalized.message });
}

export function Trace(nameOrOptions?: string | TraceDecoratorOptions): MethodDecorator {
  const options: TraceDecoratorOptions =
    typeof nameOrOptions === 'string' ? { name: nameOrOptions } : (nameOrOptions ?? {});

  return (target, propertyKey, descriptor: PropertyDescriptor) => {
    const original: unknown = descriptor.value;
    if (typeof original !== 'function') return descriptor;

    const className =
      typeof target === 'function' ? target.name : (target.constructor?.name ?? 'UnknownClass');
    const spanName = options.name ?? `${className}.${String(propertyKey)}`;
    const shouldRecord = options.recordException !== false;

    descriptor.value = function tracedMethod(this: unknown, ...args: unknown[]): unknown {
      const tracer = trace.getTracer('@aldok10/nestjs-observe-tracing');
      return tracer.startActiveSpan(
        spanName,
        {
          ...(options.kind !== undefined ? { kind: options.kind } : {}),
          ...(options.attributes !== undefined ? { attributes: options.attributes } : {}),
        },
        (span) => {
          try {
            const result = original.apply(this, args);
            if (isPromiseLike(result)) {
              return result.then(
                (resolved) => {
                  span.setStatus({ code: SpanStatusCode.OK });
                  span.end();
                  return resolved;
                },
                (error: unknown) => {
                  failSpan(span, error, shouldRecord);
                  span.end();
                  throw error;
                },
              );
            }
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
            return result;
          } catch (error: unknown) {
            failSpan(span, error, shouldRecord);
            span.end();
            throw error;
          }
        },
      );
    };

    return descriptor;
  };
}
