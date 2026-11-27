import type { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify';
import {
  HttpRequestLogBuilder,
  type HttpRequestLoggerOptions,
} from './http-request-log.builder.js';

interface RequestState {
  setError(error: unknown): void;
  emit(clientDisconnected: boolean): void;
}

const REPLY_STATES = new WeakMap<FastifyReply['raw'], RequestState>();

export interface FastifyRequestHooks {
  onRequest(
    this: void,
    request: FastifyRequest,
    reply: FastifyReply,
    done: HookHandlerDoneFunction,
  ): void;
  onResponse(
    this: void,
    request: FastifyRequest,
    reply: FastifyReply,
    done: HookHandlerDoneFunction,
  ): void;
  onError(
    this: void,
    request: FastifyRequest,
    reply: FastifyReply,
    error: Error,
    done: HookHandlerDoneFunction,
  ): void;
}

export class FastifyRequestLogger {
  constructor(
    private readonly options: HttpRequestLoggerOptions,
    private readonly builder: HttpRequestLogBuilder = new HttpRequestLogBuilder(),
  ) {}

  createHooks(): FastifyRequestHooks {
    return {
      onRequest: (request, reply, done): void => {
        if (REPLY_STATES.has(reply.raw)) {
          done();
          return;
        }

        const route = this.extractRoute(request);
        if (
          this.builder.shouldSkip(route, this.options) ||
          !this.builder.shouldSample(this.options)
        ) {
          REPLY_STATES.set(reply.raw, {
            setError: () => undefined,
            emit: () => undefined,
          });
          done();
          return;
        }

        const startedAt = performance.now();
        let emitted = false;
        let capturedError: unknown;
        const emit = (clientDisconnected: boolean): void => {
          if (emitted) return;
          emitted = true;
          const record = this.builder.build({
            options: this.options,
            method: request.method,
            route,
            statusCode: reply.statusCode,
            duration: performance.now() - startedAt,
            headers: request.headers,
            ...(typeof reply.getHeaders === 'function'
              ? { responseHeaders: reply.getHeaders() }
              : {}),
            clientDisconnected,
            ...(capturedError !== undefined ? { error: capturedError } : {}),
          });
          this.builder.write(this.options.sink, record, this.options.onError);
        };

        REPLY_STATES.set(reply.raw, {
          setError: (error: unknown) => {
            capturedError = error;
          },
          emit,
        });
        reply.raw.once('close', () => {
          if (!reply.raw.writableFinished && !emitted) emit(true);
        });
        done();
      },
      onResponse: (_request, reply, done): void => {
        REPLY_STATES.get(reply.raw)?.emit(false);
        done();
      },
      onError: (_request, reply, error, done): void => {
        REPLY_STATES.get(reply.raw)?.setError(error);
        done();
      },
    };
  }

  private extractRoute(request: FastifyRequest): string {
    const url = request.routeOptions?.url ?? request.url;
    return url.split('?')[0] ?? url;
  }
}

export function createFastifyHooks(options: HttpRequestLoggerOptions): FastifyRequestHooks {
  return new FastifyRequestLogger(options).createHooks();
}
