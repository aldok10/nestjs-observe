import { PassThrough } from 'node:stream';
import { Test } from '@nestjs/testing';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import winston from 'winston';
import {
  AdapterNotFoundException,
  type LoggerAdapter,
  type LoggerManager,
  type UniversalLogger,
} from '@aldok10/nestjs-observe-logger-core';
import { PinoLoggerAdapter } from '@aldok10/nestjs-observe-logger-adapter-pino';
import { CaptureTransport } from '@aldok10/nestjs-observe-logger-testing';
import { WinstonLoggerAdapter } from '@aldok10/nestjs-observe-logger-adapter-winston';
import { DEV_LOGGER, LOGGER_MANAGER, LoggerModule, type ChannelLogger } from './index.js';
import { createLoggerToken as createChannelLoggerToken } from './channels.js';

describe('Multi-adapter monorepo integration', () => {
  it('runs Pino adapter only without Winston', async () => {
    const stream = new PassThrough();
    const chunks: string[] = [];
    stream.on('data', (chunk: Buffer | string) => chunks.push(chunk.toString('utf8')));
    const pinoLogger = pino({ level: 'info' }, stream);

    const moduleRef = await Test.createTestingModule({
      imports: [
        LoggerModule.forRoot({
          adapters: [PinoLoggerAdapter],
          backend: { type: 'pino', logger: pinoLogger },
        }),
      ],
    }).compile();

    moduleRef.get<UniversalLogger>(DEV_LOGGER).info?.('pino-only');
    const lines = chunks
      .join('')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ msg: 'pino-only' });
    await moduleRef.close();
  });

  it('runs Winston adapter only without Pino', async () => {
    const stream = new PassThrough();
    const chunks: string[] = [];
    stream.on('data', (chunk: Buffer | string) => chunks.push(chunk.toString('utf8')));
    const winstonLogger = winston.createLogger({
      level: 'info',
      format: winston.format.json(),
      transports: [new winston.transports.Stream({ stream })],
    });

    const moduleRef = await Test.createTestingModule({
      imports: [
        LoggerModule.forRoot({
          adapters: [{ name: 'winston', useFactory: () => new WinstonLoggerAdapter() }],
          backend: { type: 'winston', logger: winstonLogger },
        }),
      ],
    }).compile();

    moduleRef.get<UniversalLogger>(DEV_LOGGER).log('winston-only');
    const lines = chunks
      .join('')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 'info', message: 'winston-only' });
    await moduleRef.close();
  });

  it('runs multiple adapters simultaneously across channels without duplicate delivery', async () => {
    const pinoStream = new PassThrough();
    const pinoChunks: string[] = [];
    pinoStream.on('data', (chunk: Buffer | string) => pinoChunks.push(chunk.toString('utf8')));

    const winstonStream = new PassThrough();
    const winstonChunks: string[] = [];
    winstonStream.on('data', (chunk: Buffer | string) =>
      winstonChunks.push(chunk.toString('utf8')),
    );

    const auditCapture = new CaptureTransport('audit');
    const pinoInstance = pino({ level: 'info' }, pinoStream);
    const winstonInstance = winston.createLogger({
      level: 'info',
      format: winston.format.json(),
      transports: [new winston.transports.Stream({ stream: winstonStream })],
    });

    const moduleRef = await Test.createTestingModule({
      imports: [
        LoggerModule.forRoot({
          adapters: [PinoLoggerAdapter, WinstonLoggerAdapter],
          channels: {
            app: { default: true, backend: { type: 'pino', logger: pinoInstance } },
            payments: { backend: { type: 'winston', logger: winstonInstance } },
            audit: { transports: [auditCapture] },
          },
        }),
      ],
    }).compile();

    moduleRef.get<ChannelLogger>(createChannelLoggerToken('app')).info('app-event');
    moduleRef.get<ChannelLogger>(createChannelLoggerToken('payments')).warn('payment-event');
    moduleRef.get<ChannelLogger>(createChannelLoggerToken('audit')).error('audit-event');
    await moduleRef.get<LoggerManager<string>>(LOGGER_MANAGER).flush();

    expect(pinoChunks.join('')).toContain('app-event');
    expect(pinoChunks.join('')).not.toContain('payment-event');
    expect(winstonChunks.join('')).toContain('payment-event');
    expect(winstonChunks.join('')).not.toContain('app-event');
    expect(auditCapture.records.map((record) => record.message)).toEqual(['audit-event']);
    await moduleRef.close();
  });

  it('surfaces adapter initialization failures during Nest module init', async () => {
    const failingAdapter: LoggerAdapter = {
      name: 'failing',
      initialize() {
        throw new Error('adapter init failed');
      },
      create() {
        return { debug() {}, log() {}, warn() {}, error() {} };
      },
    };

    const moduleRef = await Test.createTestingModule({
      imports: [
        LoggerModule.forRoot({
          adapters: [failingAdapter],
          defaultAdapter: 'failing',
        }),
      ],
    }).compile();

    await expect(moduleRef.init()).rejects.toThrow('adapter init failed');
    await moduleRef.close();
  });

  it('fails cleanly when a requested unregistered adapter is configured', async () => {
    await expect(
      Test.createTestingModule({
        imports: [
          LoggerModule.forRoot({
            adapters: [PinoLoggerAdapter],
            backend: { type: 'winston', logger: {} },
          }),
        ],
      }).compile(),
    ).rejects.toThrow(AdapterNotFoundException);
  });
});
