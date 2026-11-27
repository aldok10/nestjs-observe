import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ChannelConfiguration } from '../channels/index.js';
import type { LoggerConfigInput } from './logger-config.js';
import { normalizeLoggerConfig, resolveLoggerConfig } from './logger-config.js';

const INTEGRATION_TERMS = [
  'loki',
  'openobserve',
  'elasticsearch',
  'rotation',
  'compress',
  'pino',
  'winston',
  'express',
  'fastify',
  'sentry',
  'opentelemetry',
  'otlp',
];

describe('core configuration boundary', () => {
  it('does not describe integration settings in core config sources', () => {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const sources = ['config/logger-config.ts', 'config/env.ts', 'channels/channel.contracts.ts'];
    const offenders = sources.filter((source) => {
      const text = readFileSync(`${root}${source}`, 'utf8').toLowerCase();
      return INTEGRATION_TERMS.some((term) => text.includes(term));
    });
    expect(offenders).toEqual([]);
  });

  it('drops unrelated programmatic keys during normalization', () => {
    const input = {
      level: 'debug',
      service: 'api',
      lokiUrl: 'http://loki:3100',
      sentryDsn: 'https://example@sentry.invalid/1',
      otlpEndpoint: 'http://collector:4317',
      rotation: { compress: true },
    } as LoggerConfigInput;

    expect(normalizeLoggerConfig(input)).toEqual({ level: 'debug', service: 'api' });
    expect(resolveLoggerConfig({ programmatic: input })).toEqual({
      level: 'debug',
      service: 'api',
    });
  });

  it('ignores integration environment variables', () => {
    const resolved = resolveLoggerConfig({
      env: {
        CISEA_LOG_LEVEL: 'warn',
        LOKI_URL: 'http://loki:3100',
        OPENOBSERVE_ENDPOINT: 'http://oo:5080',
        SENTRY_DSN: 'https://example@sentry.invalid/1',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4317',
      },
    });
    expect(resolved).toEqual({ level: 'warn' });
  });

  it('rejects destination-specific fields on a core channel', () => {
    const fileChannel: ChannelConfiguration = {
      name: 'main',
      // @ts-expect-error file rotation is owned by @aldok10/nestjs-observe-logger-transport-file
      file: { path: 'app.log', rotation: { compress: true } },
    };
    const coordinated: ChannelConfiguration = {
      name: 'main',
      // @ts-expect-error multi-process coordination is not a core channel option
      multiProcess: 'singleWriter',
    };
    expect(fileChannel.name).toBe('main');
    expect(coordinated.name).toBe('main');
  });
});
