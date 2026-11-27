import { createRequire } from 'node:module';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';
import type * as RxjsTypes from 'rxjs';
import {
  HttpRequestLogBuilder,
  type HttpRequestLoggerOptions,
} from './http-request-log.builder.js';

// Optional peer: load operators only when an HTTP request is actually instrumented.
// CJS builds erase import.meta.url, so use __filename there.
const requireModule = createRequire(typeof __filename === 'string' ? __filename : import.meta.url);
type RxjsModule = typeof RxjsTypes;
let cachedRxjs: RxjsModule | undefined;
function isRxjsModule(value: unknown): value is RxjsModule {
  return typeof value === 'object' && value !== null && 'tap' in value;
}

function loadRxjs(): RxjsModule {
  if (cachedRxjs === undefined) {
    try {
      const loaded: unknown = requireModule('rxjs');
      if (!isRxjsModule(loaded)) {
        throw new Error('Invalid rxjs module');
      }
      cachedRxjs = loaded;
    } catch (error) {
      throw new Error('rxjs is required for NestHttpRequestLogger; install rxjs@^7', {
        cause: error,
      });
    }
  }
  return cachedRxjs;
}

type HttpRequest = {
  method?: string;
  originalUrl?: string;
  url?: string;
  path?: string;
  headers?: Record<string, unknown>;
  route?: { path?: unknown };
  baseUrl?: string;
};
type HttpResponse = {
  statusCode?: number;
  getHeaders?: () => Record<string, unknown>;
};

export class NestHttpRequestLogger implements NestInterceptor {
  constructor(
    private readonly options: HttpRequestLoggerOptions,
    private readonly builder: HttpRequestLogBuilder = new HttpRequestLogBuilder(),
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const req = http.getRequest<HttpRequest>();
    const res = http.getResponse<HttpResponse>();
    const route = this.extractRoute(req);
    if (this.builder.shouldSkip(route, this.options) || !this.builder.shouldSample(this.options)) {
      return next.handle();
    }

    const startedAt = performance.now();
    const emit = (error?: unknown): void => {
      const record = this.builder.build({
        options: this.options,
        method: req.method ?? 'GET',
        route,
        statusCode: res.statusCode ?? 200,
        duration: performance.now() - startedAt,
        ...(req.headers !== undefined ? { headers: req.headers } : {}),
        ...(res.getHeaders !== undefined ? { responseHeaders: res.getHeaders() } : {}),
        ...(error !== undefined ? { error } : {}),
      });
      this.builder.write(this.options.sink, record, this.options.onError);
    };

    const { catchError, tap, throwError } = loadRxjs();
    return next.handle().pipe(
      tap(() => emit()),
      catchError((error: unknown) => {
        emit(error);
        return throwError(() => error);
      }),
    );
  }

  private extractRoute(req: HttpRequest): string {
    const routePath = req.route?.path;
    if (typeof routePath === 'string') return `${req.baseUrl ?? ''}${routePath}`;
    const path = req.originalUrl ?? req.url ?? req.path ?? '/';
    return path.split('?')[0] ?? path;
  }
}

export function createNestHttpRequestLogger(
  options: HttpRequestLoggerOptions,
): NestHttpRequestLogger {
  return new NestHttpRequestLogger(options);
}
