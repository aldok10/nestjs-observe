import { describe, expect, it } from 'vitest';
import type { LogRecord } from '@aldok10/nestjs-observe-logger-core/contracts';
import { sanitize } from '@aldok10/nestjs-observe-logger-core/redaction';
import { LogPipeline } from '@aldok10/nestjs-observe-logger-core';
import {
  createAdvancedRedactor,
  fieldRedactor,
  headerRedactor,
  queryRedactor,
  regexRedactor,
} from './index.js';

function record(metadata: Record<string, unknown>): LogRecord {
  return {
    schemaVersion: 1,
    timestamp: 1_700_000_000_000,
    level: 'info',
    message: 'request',
    metadata,
  };
}

describe('advanced redaction matchers', () => {
  it('masks configured fields at any nesting depth', () => {
    const safe = sanitize(
      record({
        user: { sessionId: 'abc', name: 'Aldo' },
        items: [{ sessionId: 'def' }],
      }),
      { matchers: [fieldRedactor({ fields: ['sessionid'] })] },
    ) as { readonly metadata: { readonly user: Record<string, unknown> } };
    expect(safe.metadata.user['sessionId']).toBe('[REDACTED]');
    expect(safe.metadata.user['name']).toBe('Aldo');
  });

  it('masks keys and values matching a regex, safely with global patterns', () => {
    const matcher = regexRedactor([/^x-api-/i, /Bearer\s+\S+/i]);
    expect(matcher('x-api-key', 'v')).toBe(true);
    expect(matcher('message', 'Authorization: Bearer abc')).toBe(true);
    expect(matcher('message', 'Bearer abc')).toBe(true);
    expect(matcher('message', 'ok')).toBe(false);
  });

  it('masks headers outside an allowlist', () => {
    const matcher = headerRedactor({ allow: ['content-type', 'x-request-id'] });
    expect(matcher('authorization', 'Bearer a')).toBe(true);
    expect(matcher('Content-Type', 'application/json')).toBe(false);
    expect(matcher('x-request-id', 'req-1')).toBe(false);
  });

  it('masks sensitive query parameters inside URLs and plain strings', () => {
    const matcher = queryRedactor({ params: ['token', 'password'] });
    expect(matcher('url', 'https://example.com/cb?token=abc&page=1')).toBe(true);
    expect(matcher('message', 'password=hunter2')).toBe(true);
    expect(matcher('url', 'https://example.com/page?page=1')).toBe(false);
  });

  it('runs composed matchers before transport delivery, on top of core defaults', async () => {
    const seen: LogRecord[] = [];
    const pipeline = new LogPipeline({
      transports: [{ name: 'capture', write: (value) => void seen.push(value) }],
      redaction: {
        matchers: createAdvancedRedactor({
          fields: { fields: ['sessionid'] },
          headers: { deny: ['x-internal'] },
          query: { params: ['token'] },
        }),
      },
    });
    await pipeline.emit(
      record({
        password: 'default-secret',
        sessionId: 'session-secret',
        url: 'https://example.com?token=query-secret',
        headers: { 'x-internal': 'header-secret' },
      }),
    );
    const serialized = JSON.stringify(seen[0]);
    for (const secret of ['default-secret', 'session-secret', 'query-secret', 'header-secret']) {
      expect(serialized).not.toContain(secret);
    }
    expect(seen[0]?.metadata).toMatchObject({ password: '[REDACTED]' });
  });

  it('does not require any extension for core defaults', () => {
    const safe = sanitize(record({ password: 'hunter2' })) as {
      readonly metadata: { readonly password: string };
    };
    expect(safe.metadata.password).toBe('[REDACTED]');
  });
});
