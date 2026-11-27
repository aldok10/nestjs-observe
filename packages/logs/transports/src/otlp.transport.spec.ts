import { createLogRecord } from '@aldok10/nestjs-observe-logger-core';
import { describe, expect, it } from 'vitest';
import { OtlpLogTransport } from './otlp.transport.js';

describe('OtlpLogTransport', () => {
  it('formats and sends OTLP/HTTP JSON ExportLogsServiceRequest payloads', async () => {
    const requests: { url: string; body: string; headers: Record<string, string> }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url:
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
        body: typeof init?.body === 'string' ? init.body : '',
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      return new Response('', { status: 200 });
    };

    const transport = new OtlpLogTransport({
      endpoint: 'https://otel.example.invalid',
      serviceName: 'checkout',
      environment: 'production',
      fetchImpl,
      flushIntervalMs: 60_000,
    });

    transport.write(
      createLogRecord({
        level: 'warn',
        message: 'slow query',
        context: {
          traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
          spanId: '00f067aa0ba902b7',
        },
        metadata: { durationMs: 250 },
      }),
    );
    await transport.flush(2000);
    await transport.close();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('https://otel.example.invalid/v1/logs');
    const parsed = JSON.parse(requests[0]?.body ?? '{}') as {
      resourceLogs: Array<{
        resource: { attributes: Array<{ key: string; value: { stringValue?: string } }> };
        scopeLogs: Array<{
          logRecords: Array<{
            severityNumber: number;
            severityText: string;
            body: { stringValue: string };
            traceId?: string;
            spanId?: string;
          }>;
        }>;
      }>;
    };
    const resourceAttrs = parsed.resourceLogs[0]?.resource.attributes ?? [];
    expect(resourceAttrs).toEqual(
      expect.arrayContaining([
        { key: 'service.name', value: { stringValue: 'checkout' } },
        { key: 'deployment.environment.name', value: { stringValue: 'production' } },
      ]),
    );
    const logRecord = parsed.resourceLogs[0]?.scopeLogs[0]?.logRecords[0];
    expect(logRecord?.severityNumber).toBe(13);
    expect(logRecord?.severityText).toBe('WARN');
    expect(logRecord?.body.stringValue).toBe('slow query');
    expect(logRecord?.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(logRecord?.spanId).toBe('00f067aa0ba902b7');
  });
});
