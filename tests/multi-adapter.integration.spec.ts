import { PassThrough } from 'node:stream';
import { ConsoleLogger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import winston from 'winston';
import type { LoggerAdapter, UniversalLogger } from '@aldok10/nestjs-observe-logger-core/contracts';
import { AdapterNotFoundException } from '@aldok10/nestjs-observe-logger-core/exceptions';
import {
  DEV_LOGGER,
  LOGGER_MANAGER,
  LoggerModule,
  type ChannelLogger,
  type LoggerManager,
} from '@aldok10/nestjs-observe-logger';
import { createLoggerToken as createChannelLoggerToken } from '@aldok10/nestjs-observe-logger/channels';
import { PinoLoggerAdapter } from '@aldok10/nestjs-observe-logger-adapter-pino';
import { CaptureTransport } from '@aldok10/nestjs-observe-logger-testing';
import { WinstonLoggerAdapter } from '@aldok10/nestjs-observe-logger-adapter-winston';

function collectLines(stream: PassThrough): string[] {
  const chunks: string[] = [];
  stream.on('data', (chunk: Buffer | string) => {
    chunks.push(chunk.toString('utf8'));
  });
  return chunks;
}

describe('Monorepo Multi-Adapter Integration', () => {
  it('runs Core + Pino only via explicit adapter registration', async () => {
    const stream = new PassThrough();
    const chunks = collectLines(stream);
    const pinoLogger = pino({ level: 'trace' }, stream);

    const moduleRef = await Test.createTestingModule({
      imports: [
        LoggerModule.forRoot({
          adapters: [PinoLoggerAdapter],
          backend: { type: 'pino', logger: pinoLogger },
        }),
      ],
    }).compile();

    moduleRef.get<UniversalLogger>(DEV_LOGGER).info?.('pino only integration');
    await moduleRef.close();

    const parsed = JSON.parse(chunks.join('').trim()) as Record<string, unknown>;
    expect(parsed).toMatchObject({ level: 'info', msg: 'pino only integration' });
  });

  it('runs Core + Winston only via explicit adapter registration', async () => {
    const stream = new PassThrough();
    const chunks = collectLines(stream);
    const winstonLogger = winston.createLogger({
      level: 'debug',
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

    moduleRef.get<UniversalLogger>(DEV_LOGGER).warn('winston only integration');
    await moduleRef.close();

    const parsed = JSON.parse(chunks.join('').trim()) as Record<string, unknown>;
    expect(parsed).toMatchObject({ level: 'warn', message: 'winston only integration' });
  });

  it('runs multiple adapters simultaneously across named channels (Pino + Winston + NestJS + Capture)', async () => {
    const pinoStream = new PassThrough();
    const pinoChunks = collectLines(pinoStream);
    const pinoLogger = pino({ level: 'info' }, pinoStream);

    const winstonStream = new PassThrough();
    const winstonChunks = collectLines(winstonStream);
    const winstonLogger = winston.createLogger({
      level: 'info',
      format: winston.format.json(),
      transports: [new winston.transports.Stream({ stream: winstonStream })],
    });

    const consoleLogger = new ConsoleLogger('MultiChannel');
    const nestCalls: string[] = [];
    consoleLogger.log = (msg: unknown) => {
      nestCalls.push(String(msg));
    };

    const auditCapture = new CaptureTransport('audit');

    const moduleRef = await Test.createTestingModule({
      imports: [
        LoggerModule.forRoot({
          adapters: [PinoLoggerAdapter, WinstonLoggerAdapter],
          channels: {
            app: { default: true, backend: { type: 'pino', logger: pinoLogger } },
            payments: { backend: { type: 'winston', logger: winstonLogger } },
            system: { backend: { type: 'nestjs', logger: consoleLogger } },
            audit: { transports: [auditCapture] },
          },
        }),
      ],
    }).compile();

    moduleRef.get<ChannelLogger>(DEV_LOGGER).info('app event');
    moduleRef.get<ChannelLogger>(createChannelLoggerToken('payments')).warn('payment event');
    moduleRef.get<ChannelLogger>(createChannelLoggerToken('system')).log('system event');
    moduleRef.get<ChannelLogger>(createChannelLoggerToken('audit')).error('audit event');

    await moduleRef.get<LoggerManager<string>>(LOGGER_MANAGER).flush();
    await moduleRef.close();

    expect(JSON.parse(pinoChunks.join('').trim())).toMatchObject({ msg: 'app event' });
    expect(JSON.parse(winstonChunks.join('').trim())).toMatchObject({ message: 'payment event' });
    expect(nestCalls).toEqual(['system event']);
    expect(auditCapture.records.map((r) => r.message)).toEqual(['audit event']);
  });

  it('supports async forRootAsync returning adapters and channels, plus custom adapters', async () => {
    const target: string[] = [];
    const customAdapter: LoggerAdapter<string[]> = {
      name: 'memory-custom',
      create: (buf) => ({
        debug: (m) => buf.push(`d:${m}`),
        log: (m) => buf.push(`l:${m}`),
        warn: (m) => buf.push(`w:${m}`),
        error: (m) => buf.push(`e:${m}`),
      }),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [
        LoggerModule.forRootAsync({
          adapters: [customAdapter],
          useFactory: () => ({
            adapters: [customAdapter],
            backend: { type: 'custom', adapter: customAdapter, logger: target },
          }),
        }),
      ],
    }).compile();

    moduleRef.get<UniversalLogger>(DEV_LOGGER).error('custom async');
    await moduleRef.close();
    expect(target).toEqual(['e:custom async']);
  });

  it('surfaces adapter initialization failures during module init', async () => {
    const failingAdapter: LoggerAdapter = {
      name: 'failing-init',
      initialize() {
        throw new Error('init failed');
      },
      create: () => ({ debug() {}, log() {}, warn() {}, error() {} }),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [
        LoggerModule.forRoot({
          adapters: [failingAdapter],
          defaultAdapter: 'failing-init',
        }),
      ],
    }).compile();

    await expect(moduleRef.init()).rejects.toThrow('init failed');
    await moduleRef.close();
  });

  it('throws AdapterNotFoundException when requesting an unregistered backend', async () => {
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
