import { PassThrough } from 'node:stream';
import { Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  createLoggerManager,
  LogContextStore,
  LogPipeline,
  UniversalLoggerImpl,
} from '@aldok10/nestjs-observe-logger-core';
import type {
  LogFormatter,
  LogRecord,
  LogTransport,
  UniversalLogger,
} from '@aldok10/nestjs-observe-logger-core/contracts';
import {
  createContextProvider,
  composeContextProviders,
} from '@aldok10/nestjs-observe-logger-context';
import { createAdvancedRedactor } from '@aldok10/nestjs-observe-logger-redaction';
import {
  DEV_LOGGER,
  InjectLogger,
  LOGGER_MANAGER,
  LoggerModule,
  type LoggerManager,
} from '@aldok10/nestjs-observe-logger';
import { createLoggerToken as createChannelLoggerToken } from '@aldok10/nestjs-observe-logger/channels';
import { ConsoleTransport } from '@aldok10/nestjs-observe-logger-transports/console';
import { describe, expect, it } from 'vitest';
import {
  JsonLinesLoggerAdapter,
  type LineSink,
} from '../examples/custom-adapter/json-lines-logger.adapter.js';
import { WebhookTransport } from '../examples/custom-transport/webhook.transport.js';

const record: LogRecord = {
  schemaVersion: 1,
  timestamp: 1_700_000_000_000,
  level: 'info',
  message: 'order created',
};

describe('documented extensibility examples', () => {
  it('runs a custom transport through a channel manager', async () => {
    const payloads: unknown[] = [];
    const transport = new WebhookTransport({
      send: (payload) => {
        payloads.push(payload);
      },
    });
    const manager = createLoggerManager({
      channels: [{ name: 'app', transports: [transport] }],
    });

    manager.getLogger('app').info('webhook', { metadata: { orderId: 'o-1' } });
    await manager.flush();
    await manager.shutdown();

    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({
      level: 'info',
      message: 'webhook',
      metadata: { orderId: 'o-1' },
    });
  });

  it('registers a custom adapter by name with DEV_LOGGER', async () => {
    const lines: string[] = [];
    const sink: LineSink = { write: (line) => lines.push(line) };
    const moduleRef = await Test.createTestingModule({
      imports: [
        LoggerModule.forRoot({
          adapters: [{ name: 'json-lines', useFactory: () => new JsonLinesLoggerAdapter(sink) }],
          defaultAdapter: 'json-lines',
          level: 'info',
          context: { requestId: 'req-custom' },
        }),
      ],
    }).compile();
    await moduleRef.init();

    moduleRef.get<UniversalLogger>(DEV_LOGGER).log('order created');
    await moduleRef.close();

    const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events.some((event) => event['event'] === 'adapter.initialize')).toBe(true);
    expect(events.some((event) => event['requestId'] === 'req-custom')).toBe(true);
    expect(events.some((event) => event['message'] === 'order created')).toBe(true);
    expect(events.some((event) => event['event'] === 'adapter.dispose')).toBe(true);
  });

  it('formats pipeline output with a custom LogFormatter object', async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const lines: string[] = [];
    stdout.on('data', (chunk: Buffer) => lines.push(chunk.toString('utf8')));
    stderr.on('data', (chunk: Buffer) => lines.push(chunk.toString('utf8')));
    const formatter: LogFormatter = {
      format: (entry) => `custom:${entry.level}:${entry.message}`,
    };
    const transport = new ConsoleTransport({ formatter, stdout, stderr });
    const pipeline = new LogPipeline({ transports: [transport] });
    const logger = new UniversalLoggerImpl({ pipeline, level: 'info' });

    logger.info('order created');
    await pipeline.flush();
    await transport.close();

    expect(lines.join('')).toContain('custom:info:order created');
  });

  it('applies advanced redaction matchers in a core pipeline', async () => {
    const seen: LogRecord[] = [];
    const capture: LogTransport = {
      name: 'capture',
      write: (entry) => {
        seen.push(entry);
      },
    };
    const pipeline = new LogPipeline({
      redaction: {
        matchers: createAdvancedRedactor({
          fields: { fields: ['sessionId'] },
          headers: { deny: ['x-internal'] },
          query: { params: ['token'] },
        }),
      },
      transports: [capture],
    });

    await pipeline.emit({
      ...record,
      metadata: {
        sessionId: 'secret-session',
        headers: { 'x-internal': 'secret-header' },
        query: '?token=secret-token&keep=1',
      },
    });

    const output = JSON.stringify(seen[0]);
    expect(output).not.toContain('secret-session');
    expect(output).not.toContain('secret-header');
    expect(output).not.toContain('secret-token');
    expect(output).toContain('"sessionId":"[REDACTED]"');
    expect(output).toContain('"query":"[REDACTED]"');
  });

  it('merges a custom context provider and LogContextStore', async () => {
    const seen: LogRecord[] = [];
    const pipeline = new LogPipeline({
      transports: [
        {
          name: 'capture',
          write: (entry) => {
            seen.push(entry);
          },
        },
      ],
    });
    const store = new LogContextStore();
    store.set({ metadata: { tenant: 't-1' } });
    const context = composeContextProviders(
      store,
      createContextProvider(() => ({ requestId: 'ambient-42' })),
    );
    const logger = new UniversalLoggerImpl({ context, pipeline });

    logger.info('hello');
    await pipeline.flush();

    expect(seen[0]?.requestId).toBe('ambient-42');
    expect(seen[0]?.metadata).toEqual({ tenant: 't-1' });
  });

  it('wires channels and adapters through NestJS DI', async () => {
    class MainFeature {
      constructor(readonly logger: UniversalLogger) {}
    }
    Injectable()(MainFeature);
    (InjectLogger('main') as ParameterDecorator)(MainFeature, undefined, 0);

    class FeatureModule {}
    Module({ providers: [MainFeature], exports: [MainFeature] })(FeatureModule);

    const moduleRef = await Test.createTestingModule({
      imports: [
        LoggerModule.forRoot({
          channels: {
            main: { default: true, transports: [] },
            audit: { transports: [] },
          },
        }),
        LoggerModule.forFeature(['main', 'audit']),
        FeatureModule,
      ],
    }).compile();

    const manager = moduleRef.get<LoggerManager<string>>(LOGGER_MANAGER);
    expect(moduleRef.get(createChannelLoggerToken('main'))).toBe(moduleRef.get(MainFeature).logger);
    expect(moduleRef.get(DEV_LOGGER)).toBe(manager.getLogger());
    expect(moduleRef.get(createChannelLoggerToken('audit'))).toBe(manager.getLogger('audit'));
    await moduleRef.close();
  });
});
