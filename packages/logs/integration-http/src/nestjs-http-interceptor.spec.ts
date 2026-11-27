import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';
import type { LogRecord } from '@aldok10/nestjs-observe-logger-core/contracts';
import type { LogSink } from '@aldok10/nestjs-observe-logger-core';
import type { HttpRequestLoggerOptions } from './http-request-log.builder.js';
import { createNestHttpRequestLogger } from './nestjs.js';

function httpContext(
  request: Record<string, unknown>,
  response: Record<string, unknown>,
  type = 'http',
): ExecutionContext {
  return {
    getType: () => type,
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ExecutionContext;
}

function createRequest(): Record<string, unknown> {
  const request: Record<string, unknown> = {
    method: 'POST',
    originalUrl: '/orders?token=query-secret',
    headers: { 'x-secret': 'header-secret', 'x-request-id': 'req-1' },
    route: { path: '/orders' },
  };
  // Instrumentation must never read or buffer the body for logging.
  Object.defineProperty(request, 'body', {
    get(): never {
      throw new Error('body must not be read');
    },
  });
  return request;
}

describe('NestHttpRequestLogger interceptor', () => {
  it('emits one record on success without reading the body or leaking headers', async () => {
    const records: LogRecord[] = [];
    const options: HttpRequestLoggerOptions = {
      sink: ((record) => void records.push(record)) as LogSink,
    };
    const response = {
      statusCode: 201,
      getHeaders: () => ({ 'set-cookie': 'session=secret' }),
    };
    const next: CallHandler = { handle: () => of({ ok: true }) };

    const result = await firstValueFrom(
      createNestHttpRequestLogger(options).intercept(httpContext(createRequest(), response), next),
    );

    expect(result).toEqual({ ok: true });
    expect(records).toHaveLength(1);
    expect(records[0]?.route).toBe('/orders');
    expect(records[0]?.statusCode).toBe(201);
    expect(records[0]?.requestId).toBe('req-1');
    expect(records[0]?.metadata?.['responseHeaders']).toBeUndefined();
    const serialized = JSON.stringify(records[0]);
    expect(serialized).not.toContain('header-secret');
    expect(serialized).not.toContain('session=secret');
  });

  it('logs errors and rethrows them unchanged', async () => {
    const records: LogRecord[] = [];
    const options: HttpRequestLoggerOptions = {
      sink: ((record) => void records.push(record)) as LogSink,
    };
    const failure = new Error('boom');
    const next: CallHandler = { handle: () => throwError(() => failure) };

    await expect(
      firstValueFrom(
        createNestHttpRequestLogger(options).intercept(
          httpContext(createRequest(), { statusCode: 500 }),
          next,
        ),
      ),
    ).rejects.toBe(failure);

    expect(records).toHaveLength(1);
    expect(records[0]?.level).toBe('error');
    expect(records[0]?.error?.message).toBe('boom');
  });

  it('passes non-HTTP contexts through untouched', async () => {
    const records: LogRecord[] = [];
    const options: HttpRequestLoggerOptions = {
      sink: ((record) => void records.push(record)) as LogSink,
    };
    const next: CallHandler = { handle: () => of('untouched') };

    const result = await firstValueFrom(
      createNestHttpRequestLogger(options).intercept(httpContext({}, {}, 'ws'), next),
    );

    expect(result).toBe('untouched');
    expect(records).toHaveLength(0);
  });
});
