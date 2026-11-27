import { tryLoadOptionalPeer } from '@aldok10/nestjs-observe-core';
import {
  Catch,
  HttpException,
  Inject,
  Injectable,
  Optional,
  type ArgumentsHost,
  type CallHandler,
  type ExceptionFilter,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { HttpAdapterHost } from '@nestjs/core';
import type { ErrorRequestContext, ErrorSeverity } from './error-tracking.contracts.js';
import { ObserveErrorTracker } from './observe-error-tracker.service.js';

interface HttpRequestLike {
  readonly method?: string;
  readonly originalUrl?: string;
  readonly url?: string;
  readonly headers?: Readonly<Record<string, unknown>>;
  readonly query?: Readonly<Record<string, unknown>>;
  readonly ip?: string;
  readonly route?: { readonly path?: string };
}

type PipeOperator = Parameters<ReturnType<CallHandler['handle']>['pipe']>[0];

interface RxjsTapModule {
  tap(observer: { error?: (error: unknown) => void }): PipeOperator;
}

function isRxjsTapModule(value: unknown): value is RxjsTapModule {
  return typeof value === 'object' && value !== null && 'tap' in value;
}

function extractSafeRequestContext(
  host: ArgumentsHost,
  statusCode?: number,
): ErrorRequestContext | undefined {
  if (host.getType() !== 'http') return undefined;
  const req = host.switchToHttp().getRequest<HttpRequestLike | undefined>();
  if (req === undefined) return undefined;
  return {
    ...(req.method !== undefined ? { method: req.method } : {}),
    ...(req.originalUrl !== undefined || req.url !== undefined
      ? { url: req.originalUrl ?? req.url }
      : {}),
    ...(req.route?.path !== undefined ? { route: req.route.path } : {}),
    ...(statusCode !== undefined ? { statusCode } : {}),
    ...(req.headers !== undefined ? { headers: req.headers } : {}),
    ...(req.query !== undefined ? { query: req.query } : {}),
    ...(req.ip !== undefined ? { ip: req.ip } : {}),
  };
}

export interface ObserveExceptionFilterOptions {
  readonly minStatusCode?: number;
  readonly rethrow?: boolean;
}

export class ObserveExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly errorTracker: ObserveErrorTracker,
    private readonly httpAdapterHost?: HttpAdapterHost,
    private readonly options: ObserveExceptionFilterOptions = {},
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const isHttpException = exception instanceof HttpException;
    const statusCode = isHttpException ? exception.getStatus() : 500;
    const minStatus = this.options.minStatusCode ?? 500;

    if (statusCode >= minStatus) {
      const severity: ErrorSeverity = statusCode >= 500 ? 'error' : 'warning';
      const request = extractSafeRequestContext(host, statusCode);
      void this.errorTracker.captureException(exception, {
        severity,
        handled: true,
        source: {
          component: 'nestjs-exception-filter',
          operation: host.getType(),
        },
        ...(request !== undefined ? { request } : {}),
      });
    }

    if (host.getType() === 'http' && this.httpAdapterHost?.httpAdapter !== undefined) {
      const ctx = host.switchToHttp();
      const body = isHttpException
        ? exception.getResponse()
        : { statusCode: 500, message: 'Internal server error' };
      this.httpAdapterHost.httpAdapter.reply(ctx.getResponse(), body, statusCode);
      return;
    }

    if (this.options.rethrow !== false) {
      throw exception;
    }
  }
}

Catch()(ObserveExceptionFilter);
Injectable()(ObserveExceptionFilter);
Inject(ObserveErrorTracker)(ObserveExceptionFilter, undefined, 0);
Optional()(ObserveExceptionFilter, undefined, 1);

export class ErrorTrackingInterceptor implements NestInterceptor {
  constructor(private readonly errorTracker: ObserveErrorTracker) {}

  intercept(ctx: ExecutionContext, next: CallHandler): ReturnType<CallHandler['handle']> {
    const stream = next.handle();
    const rxjs = tryLoadOptionalPeer('rxjs');
    if (!isRxjsTapModule(rxjs)) return stream;

    const className = ctx.getClass().name;
    const handlerName = ctx.getHandler().name;
    return stream.pipe(
      rxjs.tap({
        error: (err: unknown) => {
          const request = extractSafeRequestContext(ctx);
          void this.errorTracker.captureException(err, {
            severity: 'error',
            handled: false,
            source: {
              component: className,
              operation: handlerName,
            },
            ...(request !== undefined ? { request } : {}),
          });
        },
      }),
    );
  }
}

Injectable()(ErrorTrackingInterceptor);
Inject(ObserveErrorTracker)(ErrorTrackingInterceptor, undefined, 0);

export class ProcessErrorMonitor {
  private readonly onUncaught = (error: unknown): void => {
    void this.errorTracker.captureException(error, {
      severity: 'fatal',
      handled: false,
      source: { component: 'process', operation: 'uncaughtException' },
    });
  };

  private readonly onUnhandled = (reason: unknown): void => {
    void this.errorTracker.captureException(reason, {
      severity: 'fatal',
      handled: false,
      source: { component: 'process', operation: 'unhandledRejection' },
    });
  };

  private attached = false;

  constructor(private readonly errorTracker: ObserveErrorTracker) {}

  start(): void {
    if (this.attached) return;
    process.on('uncaughtException', this.onUncaught);
    process.on('unhandledRejection', this.onUnhandled);
    this.attached = true;
  }

  stop(): void {
    if (!this.attached) return;
    process.off('uncaughtException', this.onUncaught);
    process.off('unhandledRejection', this.onUnhandled);
    this.attached = false;
  }
}
