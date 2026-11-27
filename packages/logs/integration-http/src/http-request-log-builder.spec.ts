import { describe, expect, it, vi } from 'vitest';
import type { LogLevel } from '@aldok10/nestjs-observe-logger-core';
import {
  DEFAULT_HEADER_ALLOWLIST,
  HttpRequestLogBuilder,
  buildRequestLogRecord,
  isExcluded,
  shouldSample,
  type HttpLogLevels,
  type HttpRequestLoggerOptions,
} from './index.js';

function createOptions(
  overrides: Partial<HttpRequestLoggerOptions> = {},
): HttpRequestLoggerOptions {
  return {
    sink: () => undefined,
    ...overrides,
  };
}

const STATUS_LEVEL_CASES: ReadonlyArray<{
  readonly label: string;
  readonly statusCode: number;
  readonly clientDisconnected?: boolean;
  readonly levels?: HttpLogLevels;
  readonly expectedLevel: LogLevel;
}> = [
  { label: '2xx defaults to info', statusCode: 200, expectedLevel: 'info' },
  { label: '4xx defaults to warn', statusCode: 404, expectedLevel: 'warn' },
  { label: '5xx defaults to error', statusCode: 503, expectedLevel: 'error' },
  {
    label: 'client disconnect maps to warn',
    statusCode: 200,
    clientDisconnected: true,
    expectedLevel: 'warn',
  },
  {
    label: 'custom level overrides apply',
    statusCode: 500,
    levels: { success: 'debug', serverError: 'fatal' },
    expectedLevel: 'fatal',
  },
];

const ROUTE_EXCLUSION_CASES: ReadonlyArray<{
  readonly route: string;
  readonly exclude: readonly (string | RegExp)[];
  readonly expected: boolean;
}> = [
  { route: '/health', exclude: ['/health'], expected: true },
  { route: '/metrics/cpu', exclude: [/^\/metrics/], expected: true },
  { route: '/users', exclude: ['/health'], expected: false },
];

const SAMPLING_CASES: ReadonlyArray<{
  readonly sampleRate: number;
  readonly randomValue: number;
  readonly expected: boolean;
}> = [
  { sampleRate: 0, randomValue: 0.1, expected: false },
  { sampleRate: 1, randomValue: 0.99, expected: true },
  { sampleRate: 0.5, randomValue: 0.25, expected: true },
  { sampleRate: 0.2, randomValue: 0.25, expected: false },
];

describe('HttpRequestLogBuilder', () => {
  describe('build', () => {
    it('maps request fields, ids and allowlisted headers without sensitive headers', () => {
      const record = buildRequestLogRecord({
        options: createOptions({
          requestId: { enabled: true, header: 'x-request-id', trustIncoming: true },
        }),
        method: 'POST',
        route: '/items',
        statusCode: 201,
        duration: 12.4,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'user-agent': 'test-agent',
          'x-request-id': 'req-1',
          'x-correlation-id': 'corr-1',
          traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
          authorization: 'Bearer secret',
          cookie: 'session=secret',
        },
      });

      expect(record.method).toBe('POST');
      expect(record.route).toBe('/items');
      expect(record.statusCode).toBe(201);
      expect(record.duration).toBe(12.4);
      expect(record.message).toContain('12ms');
      expect(record.requestId).toBe('req-1');
      expect(record.correlationId).toBe('corr-1');
      expect(record.traceId).toBe('0123456789abcdef0123456789abcdef');
      expect(record.spanId).toBe('0123456789abcdef');
      expect(record.metadata?.['headers']).toMatchObject({
        accept: 'application/json',
        'x-request-id': 'req-1',
        traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
      });
      expect(record.metadata?.['headers']).not.toHaveProperty('authorization');
      expect(record.metadata?.['headers']).not.toHaveProperty('cookie');
      expect(JSON.stringify(record)).not.toContain('Bearer secret');
      expect(DEFAULT_HEADER_ALLOWLIST).toContain('traceparent');
    });

    it('respects disabled incoming ids and custom generator', () => {
      const record = new HttpRequestLogBuilder().build({
        options: createOptions({
          requestId: { enabled: true, trustIncoming: false, generator: () => 'generated' },
        }),
        method: 'GET',
        route: '/',
        statusCode: 200,
        duration: 1,
        headers: { 'x-request-id': 'incoming' },
      });
      expect(record.requestId).toBe('generated');
    });

    it('flags slow requests when duration exceeds threshold', () => {
      const slow = buildRequestLogRecord({
        options: createOptions({ slowRequestMs: 10 }),
        method: 'GET',
        route: '/slow',
        statusCode: 200,
        duration: 11,
      });
      expect(slow.metadata?.['slowRequest']).toBe(true);
    });

    it.each(STATUS_LEVEL_CASES)(
      '$label',
      ({ statusCode, clientDisconnected, levels, expectedLevel }) => {
        const record = buildRequestLogRecord({
          options: createOptions(levels !== undefined ? { levels } : {}),
          method: 'GET',
          route: '/status',
          statusCode,
          duration: 2,
          ...(clientDisconnected !== undefined ? { clientDisconnected } : {}),
        });
        expect(record.level).toBe(expectedLevel);
      },
    );
  });

  describe('isExcluded', () => {
    it.each(ROUTE_EXCLUSION_CASES)(
      'route "$route" -> $expected',
      ({ route, exclude, expected }) => {
        expect(isExcluded(route, exclude)).toBe(expected);
      },
    );
  });

  describe('shouldSkip', () => {
    it('skips routes not in include list', () => {
      const builder = new HttpRequestLogBuilder();
      expect(builder.shouldSkip('/health', createOptions({ include: ['/api'] }))).toBe(true);
      expect(builder.shouldSkip('/api/users', createOptions({ include: [/^\/api/] }))).toBe(false);
    });
  });

  describe('shouldSample', () => {
    it.each(SAMPLING_CASES)(
      'sampleRate=$sampleRate with random=$randomValue -> $expected',
      ({ sampleRate, randomValue, expected }) => {
        const random = vi.spyOn(Math, 'random').mockReturnValue(randomValue);
        try {
          expect(shouldSample(createOptions({ sampleRate }))).toBe(expected);
        } finally {
          random.mockRestore();
        }
      },
    );
  });
});
