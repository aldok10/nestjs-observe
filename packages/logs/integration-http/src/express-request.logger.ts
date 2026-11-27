import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
  HttpRequestLogBuilder,
  type HttpRequestLoggerOptions,
} from './http-request-log.builder.js';

interface ExpressResponseState {
  instrumented: boolean;
  error?: unknown;
}

const RESPONSE_STATES = new WeakMap<Response, ExpressResponseState>();

function getOrCreateState(res: Response): ExpressResponseState {
  const existing = RESPONSE_STATES.get(res);
  if (existing !== undefined) return existing;
  const created: ExpressResponseState = { instrumented: false };
  RESPONSE_STATES.set(res, created);
  return created;
}

function readRoutePath(route: unknown): string | undefined {
  if (typeof route !== 'object' || route === null || !('path' in route)) return undefined;
  return typeof route.path === 'string' ? route.path : undefined;
}

export class ExpressRequestLogger {
  constructor(
    private readonly options: HttpRequestLoggerOptions,
    private readonly builder: HttpRequestLogBuilder = new HttpRequestLogBuilder(),
  ) {}

  createMiddleware(): RequestHandler {
    return (req: Request, res: Response, next: NextFunction): void => {
      const state = getOrCreateState(res);
      if (state.instrumented) {
        next();
        return;
      }
      const route = this.extractRoute(req);
      if (
        this.builder.shouldSkip(route, this.options) ||
        !this.builder.shouldSample(this.options)
      ) {
        next();
        return;
      }
      state.instrumented = true;

      const startedAt = performance.now();
      let emitted = false;
      const emit = (clientDisconnected: boolean): void => {
        if (emitted) return;
        emitted = true;
        const record = this.builder.build({
          options: this.options,
          method: req.method,
          route: this.extractRoute(req),
          statusCode: res.statusCode,
          duration: performance.now() - startedAt,
          headers: req.headers,
          ...(res.getHeaders !== undefined ? { responseHeaders: res.getHeaders() } : {}),
          clientDisconnected,
          ...(state.error !== undefined ? { error: state.error } : {}),
        });
        this.builder.write(this.options.sink, record, this.options.onError);
      };

      res.once('finish', () => emit(false));
      res.once('close', () => {
        if (!res.writableFinished) emit(true);
      });
      next();
    };
  }

  createErrorMiddleware(): (
    error: unknown,
    req: Request,
    res: Response,
    next: NextFunction,
  ) => void {
    return (error: unknown, _req: Request, res: Response, next: NextFunction): void => {
      getOrCreateState(res).error = error;
      next(error);
    };
  }

  private extractRoute(req: Request): string {
    const routePath = readRoutePath(req.route);
    if (routePath !== undefined) return `${req.baseUrl ?? ''}${routePath}`;
    const path = typeof req.originalUrl === 'string' ? req.originalUrl : req.path;
    return path.split('?')[0] ?? path;
  }
}

export function createExpressRequestLogger(options: HttpRequestLoggerOptions): RequestHandler {
  return new ExpressRequestLogger(options).createMiddleware();
}

export function createExpressErrorLogger(): (
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
) => void {
  return new ExpressRequestLogger({ sink: () => undefined }).createErrorMiddleware();
}
