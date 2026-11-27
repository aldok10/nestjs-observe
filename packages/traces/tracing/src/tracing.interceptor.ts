import { tryLoadOptionalPeer } from '@aldok10/nestjs-observe-core';
import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';

type PipeOperator = Parameters<ReturnType<CallHandler['handle']>['pipe']>[0];

interface RxjsTapModule {
  tap(observer: { error?: (error: unknown) => void; complete?: () => void }): PipeOperator;
}

function isRxjsTapModule(value: unknown): value is RxjsTapModule {
  return typeof value === 'object' && value !== null && 'tap' in value;
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(typeof error === 'string' ? error : JSON.stringify(error));
}

export class TracingInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): ReturnType<CallHandler['handle']> {
    const className = ctx.getClass().name;
    const handlerName = ctx.getHandler().name;
    const tracer = trace.getTracer('@aldok10/nestjs-observe-tracing');
    const span = tracer.startSpan(`${className}.${handlerName}`, {
      kind: SpanKind.INTERNAL,
      attributes: {
        'code.namespace': className,
        'code.function': handlerName,
      },
    });

    const stream = next.handle();
    const rxjs = tryLoadOptionalPeer('rxjs');
    if (!isRxjsTapModule(rxjs)) {
      span.end();
      return stream;
    }

    let ended = false;
    const finish = (error?: unknown): void => {
      if (ended) return;
      ended = true;
      if (error !== undefined) {
        const normalized = toError(error);
        span.recordException(normalized);
        span.setStatus({ code: SpanStatusCode.ERROR, message: normalized.message });
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }
      span.end();
    };

    return stream.pipe(
      rxjs.tap({
        error: (err) => finish(err),
        complete: () => finish(),
      }),
    );
  }
}

Injectable()(TracingInterceptor);
