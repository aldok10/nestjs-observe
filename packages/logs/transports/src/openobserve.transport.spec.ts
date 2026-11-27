import { describe, expect, it } from 'vitest';
import { createLogRecord } from '@aldok10/nestjs-observe-logger-core';
import { OpenObserveTransport } from './openobserve.transport.js';

type FetchCall = {
  readonly input: string | URL | Request;
  readonly init?: RequestInit | undefined;
};

function createFetchStub() {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push(init === undefined ? { input } : { input, init });
    return new Response('', { status: 200 });
  };
  return { calls, fetchImpl };
}

function headerValue(
  headers: RequestInit['headers'] | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  if (Array.isArray(headers)) {
    const pair = headers.find(([key]) => (key ?? '').toLowerCase() === name.toLowerCase());
    return pair?.[1];
  }
  return (
    (headers as Record<string, string>)[name] ??
    (headers as Record<string, string>)[name.toLowerCase()]
  );
}

describe('OpenObserveTransport', () => {
  it('posts JSON array payload to org/stream endpoint with json content type', async () => {
    const { calls, fetchImpl } = createFetchStub();
    const transport = new OpenObserveTransport({
      endpoint: 'https://logs.example.com/base/',
      organization: 'my-org',
      stream: 'app-logs',
      fetchImpl,
      flushIntervalMs: 60_000,
      batchSize: 10,
    });

    transport.write(createLogRecord({ level: 'info', message: 'hello' }));
    await transport.flush();
    await transport.close();

    expect(calls).toHaveLength(1);
    const inputUrl = calls[0]?.input;
    expect(
      typeof inputUrl === 'string'
        ? inputUrl
        : inputUrl instanceof URL
          ? inputUrl.href
          : inputUrl?.url,
    ).toBe('https://logs.example.com/base/api/my-org/app-logs/_json');
    expect(headerValue(calls[0]?.init?.headers, 'Content-Type')).toBe('application/json');

    const body = calls[0]?.init?.body;
    expect(typeof body).toBe('string');
    const parsed = JSON.parse(body as string) as Array<Record<string, unknown>>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ message: 'hello', level: 'info' });
  });

  it('uses Basic auth with token and tokenName', async () => {
    const { calls, fetchImpl } = createFetchStub();
    const transport = new OpenObserveTransport({
      fetchImpl,
      flushIntervalMs: 60_000,
      token: 'secret-token',
      tokenName: 'my-token',
    });

    transport.write(createLogRecord({ level: 'warn', message: 'auth' }));
    await transport.flush();
    await transport.close();

    expect(calls).toHaveLength(1);
    const expected = `Basic ${Buffer.from('my-token:secret-token').toString('base64')}`;
    expect(headerValue(calls[0]?.init?.headers, 'Authorization')).toBe(expected);
  });

  it('uses Basic auth with username and password', async () => {
    const { calls, fetchImpl } = createFetchStub();
    const transport = new OpenObserveTransport({
      fetchImpl,
      flushIntervalMs: 60_000,
      username: 'alice',
      password: 'pass',
    });

    transport.write(createLogRecord({ level: 'error', message: 'auth' }));
    await transport.flush();
    await transport.close();

    expect(calls).toHaveLength(1);
    const expected = `Basic ${Buffer.from('alice:pass').toString('base64')}`;
    expect(headerValue(calls[0]?.init?.headers, 'Authorization')).toBe(expected);
  });

  it('defaults endpoint, org, stream, and tokenName', async () => {
    const { calls, fetchImpl } = createFetchStub();
    const transport = new OpenObserveTransport({
      fetchImpl,
      flushIntervalMs: 60_000,
      token: 't',
    });

    transport.write(createLogRecord({ level: 'debug', message: 'defaults' }));
    await transport.flush();
    await transport.close();

    expect(calls).toHaveLength(1);
    const inputUrl = calls[0]?.input;
    expect(
      typeof inputUrl === 'string'
        ? inputUrl
        : inputUrl instanceof URL
          ? inputUrl.href
          : inputUrl?.url,
    ).toBe('http://localhost:5080/api/default/logs/_json');
    const expected = `Basic ${Buffer.from('default:t').toString('base64')}`;
    expect(headerValue(calls[0]?.init?.headers, 'Authorization')).toBe(expected);
  });
});
