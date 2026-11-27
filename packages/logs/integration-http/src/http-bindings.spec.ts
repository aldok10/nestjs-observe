import { EventEmitter } from 'node:events';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import Fastify from 'fastify';
import supertest from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { LogRecord } from '@aldok10/nestjs-observe-logger-core/contracts';
import type { LogSink } from '@aldok10/nestjs-observe-logger-core';
import {
  createExpressErrorLogger,
  createExpressRequestLogger,
  createFastifyHooks,
  type HttpRequestLoggerOptions,
} from './index.js';

interface CapturingSink {
  readonly sink: LogSink;
  readonly records: LogRecord[];
}

function createCapturingSink(): CapturingSink {
  const records: LogRecord[] = [];
  return {
    sink: (record) => {
      records.push(record);
    },
    records,
  };
}

function createOptions(
  sink: LogSink,
  overrides: Partial<HttpRequestLoggerOptions> = {},
): HttpRequestLoggerOptions {
  return { sink, ...overrides };
}

describe('ExpressRequestLogger', () => {
  it('emits one completion record with status, route and duration', async () => {
    const { sink, records } = createCapturingSink();
    const app = express();
    app.use(createExpressRequestLogger(createOptions(sink)));
    app.get('/users/:id', (_req, res) => {
      res.status(201).json({ body: 'never logged' });
    });

    const response = await supertest(app).get('/users/42').expect(201);
    expect(response.body).toEqual({ body: 'never logged' });
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record?.method).toBe('GET');
    expect(record?.route).toBe('/users/:id');
    expect(record?.statusCode).toBe(201);
    expect(record?.duration).toBeGreaterThanOrEqual(0);
    expect(record?.level).toBe('info');
    expect(JSON.stringify(record)).not.toContain('never logged');
  });

  it('applies the header allowlist and custom serializer', async () => {
    const serializeHeaders = vi.fn((headers: Record<string, unknown>) => ({
      ...headers,
      seen: true,
    }));
    const { sink, records } = createCapturingSink();
    const app = express();
    app.use(createExpressRequestLogger(createOptions(sink, { serializeHeaders })));
    app.get('/headers', (_req, res) => res.send('ok'));

    await supertest(app)
      .get('/headers')
      .set('x-secret', 'leak-me')
      .set('x-request-id', 'req-77')
      .expect(200);

    expect(serializeHeaders).toHaveBeenCalledTimes(1);
    expect(serializeHeaders.mock.calls[0]?.[0]).not.toHaveProperty('x-secret');
    expect(records[0]?.requestId).toBe('req-77');
    expect(JSON.stringify(records[0])).not.toContain('leak-me');
  });

  it('excludes routes and honours sampling', async () => {
    const excluded = createCapturingSink();
    const app = express();
    app.use(createExpressRequestLogger(createOptions(excluded.sink, { exclude: ['/health'] })));
    app.get('/health', (_req, res) => res.send('ok'));
    app.get('/users', (_req, res) => res.send('ok'));
    await supertest(app).get('/health').expect(200);
    expect(excluded.records).toHaveLength(0);
    await supertest(app).get('/users').expect(200);
    expect(excluded.records).toHaveLength(1);

    const sampled = createCapturingSink();
    const sampledApp = express();
    sampledApp.use(createExpressRequestLogger(createOptions(sampled.sink, { sampleRate: 0 })));
    sampledApp.get('/users', (_req, res) => res.send('ok'));
    await supertest(sampledApp).get('/users').expect(200);
    expect(sampled.records).toHaveLength(0);
  });

  it('detects client disconnect instead of double logging', () => {
    const { sink, records } = createCapturingSink();
    const middleware = createExpressRequestLogger(createOptions(sink));
    const res = Object.assign(new EventEmitter(), {
      statusCode: 200,
      writableFinished: false,
    }) as unknown as Response;
    const req = {
      method: 'GET',
      headers: {},
      route: { path: '/abort' },
      baseUrl: '',
    } as unknown as Request;
    const next = vi.fn() as NextFunction;

    middleware(req, res, next);
    res.emit('close');
    res.emit('finish');

    expect(next).toHaveBeenCalledTimes(1);
    expect(records).toHaveLength(1);
    expect(records[0]?.metadata?.['clientDisconnected']).toBe(true);
    expect(records[0]?.level).toBe('warn');
  });

  it('forwards errors to next and logs them once', async () => {
    const { sink, records } = createCapturingSink();
    const app = express();
    app.use(createExpressRequestLogger(createOptions(sink)));
    app.get('/boom', () => {
      throw new Error('kaboom');
    });
    app.use(createExpressErrorLogger());
    app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
      res.status(500).send(error.message);
    });

    await supertest(app).get('/boom').expect(500);
    expect(records).toHaveLength(1);
    expect(records[0]?.statusCode).toBe(500);
    expect(records[0]?.level).toBe('error');
    expect(records[0]?.error?.message).toBe('kaboom');
  });
});

describe('FastifyRequestLogger', () => {
  it('emits one completion record with status, route and duration', async () => {
    const { sink, records } = createCapturingSink();
    const app = Fastify();
    const hooks = createFastifyHooks(createOptions(sink));
    app.addHook('onRequest', hooks.onRequest);
    app.addHook('onResponse', hooks.onResponse);
    app.get('/users/:id', () => ({ body: 'never logged' }));

    const response = await app.inject({ method: 'GET', url: '/users/42' });
    expect(response.statusCode).toBe(200);
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record?.route).toBe('/users/:id');
    expect(record?.statusCode).toBe(200);
    expect(record?.duration).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(record)).not.toContain('never logged');
    await app.close();
  });

  it('excludes routes and honours sampling', async () => {
    const excluded = createCapturingSink();
    const app = Fastify();
    const hooks = createFastifyHooks(
      createOptions(excluded.sink, { exclude: [/^\/health/], sampleRate: 0 }),
    );
    app.addHook('onRequest', hooks.onRequest);
    app.addHook('onResponse', hooks.onResponse);
    app.get('/health', () => 'ok');
    app.get('/users', () => 'ok');
    await app.inject({ method: 'GET', url: '/health' });
    await app.inject({ method: 'GET', url: '/users' });
    expect(excluded.records).toHaveLength(0);
    await app.close();

    const sampled = createCapturingSink();
    const sampledApp = Fastify();
    const sampledHooks = createFastifyHooks(createOptions(sampled.sink, { sampleRate: 1 }));
    sampledApp.addHook('onRequest', sampledHooks.onRequest);
    sampledApp.addHook('onResponse', sampledHooks.onResponse);
    sampledApp.get('/users', () => 'ok');
    await sampledApp.inject({ method: 'GET', url: '/users' });
    expect(sampled.records).toHaveLength(1);
    await sampledApp.close();
  });

  it('detects client disconnect via reply.raw close', () => {
    const { sink, records } = createCapturingSink();
    const hooks = createFastifyHooks(createOptions(sink));
    const raw = Object.assign(new EventEmitter(), { writableFinished: false });
    const request = {
      method: 'GET',
      url: '/abort',
      headers: {},
      routeOptions: { url: '/abort' },
    } as never;
    const reply = { raw, statusCode: 200 } as never;
    const done = vi.fn();

    hooks.onRequest(request, reply, done);
    raw.emit('close');
    hooks.onResponse(request, reply, done);

    expect(done).toHaveBeenCalledTimes(2);
    expect(records).toHaveLength(1);
    expect(records[0]?.metadata?.['clientDisconnected']).toBe(true);
    expect(records[0]?.level).toBe('warn');
  });

  it('logs errors captured by the onError hook once', async () => {
    const { sink, records } = createCapturingSink();
    const app = Fastify();
    const hooks = createFastifyHooks(createOptions(sink));
    app.addHook('onRequest', hooks.onRequest);
    app.addHook('onResponse', hooks.onResponse);
    app.addHook('onError', hooks.onError);
    app.get('/boom', () => {
      throw new Error('kaboom');
    });

    const response = await app.inject({ method: 'GET', url: '/boom' });
    expect(response.statusCode).toBe(500);
    expect(records).toHaveLength(1);
    expect(records[0]?.level).toBe('error');
    expect(records[0]?.error?.message).toBe('kaboom');
    await app.close();
  });
});
