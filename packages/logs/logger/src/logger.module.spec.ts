import { Inject, Injectable, Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import type {
  LogRecord,
  LogTransport,
  LoggerAdapter,
  LoggerAdapterOptions,
  UniversalLogger,
} from '@aldok10/nestjs-observe-logger-core/contracts';
import {
  AdapterNotFoundException,
  InvalidLoggerConfigurationException,
} from '@aldok10/nestjs-observe-logger-core/exceptions';
import {
  AdapterResolver,
  DEV_LOGGER,
  DevLoggerModule,
  InjectLogger,
  LOGGER_MANAGER,
  LOGGER_OPTIONS,
  LOG_TRANSPORTS,
  LifecycleManager,
  LifecycleService,
  LogContextStore,
  LogPipeline,
  LoggerAdapterRegistry,
  LoggerModule,
  UniversalLoggerImpl,
  UnknownChannelError,
  createLoggerToken,
  type ChannelLogger,
  type DevLoggerAsyncOptions,
  type DevLoggerChannels,
  type DevLoggerOptions,
  type DevLoggerOptionsFactory,
  type LoggerManager,
} from './index.js';
import { createLoggerToken as createChannelLoggerToken } from './channels.js';
import { normalizeChannels } from './logger.module.js';

interface CaptureTransport extends LogTransport {
  readonly records: LogRecord[];
  readonly closeSpy: ReturnType<typeof vi.fn>;
}

function captureTransport(): CaptureTransport {
  const records: LogRecord[] = [];
  const closeSpy = vi.fn(async () => undefined);
  return {
    name: 'capture',
    records,
    closeSpy,
    write(record: LogRecord): void {
      records.push(record);
    },
    close(): Promise<void> {
      return closeSpy();
    },
  };
}

function baseOptions(transport: LogTransport): DevLoggerOptions {
  return { level: 'debug', transports: [transport] };
}

class AsyncOptionsFactory implements DevLoggerOptionsFactory {
  constructor(private readonly transport: LogTransport) {}

  createDevLoggerOptions(): DevLoggerOptions {
    return baseOptions(this.transport);
  }
}

const existingTransport = captureTransport();

class ExistingOptionsFactory implements DevLoggerOptionsFactory {
  createDevLoggerOptions(): DevLoggerOptions {
    return baseOptions(existingTransport);
  }
}

class OptionsModule {}
Module({
  providers: [ExistingOptionsFactory],
  exports: [ExistingOptionsFactory],
})(OptionsModule);

class PaymentFeature {
  constructor(readonly logger: ChannelLogger) {}
}
Injectable()(PaymentFeature);
(InjectLogger('payment') as ParameterDecorator)(PaymentFeature, undefined, 0);

class MainFeature {
  constructor(readonly logger: ChannelLogger) {}
}
Injectable()(MainFeature);
(InjectLogger('main') as ParameterDecorator)(MainFeature, undefined, 0);

class PaymentFeatureModule {}
Module({ providers: [PaymentFeature], exports: [PaymentFeature] })(PaymentFeatureModule);

class MainFeatureModule {}
Module({ providers: [MainFeature], exports: [MainFeature] })(MainFeatureModule);

const INVALID_ASYNC_STRATEGY_CASES: ReadonlyArray<{
  readonly label: string;
  readonly options: DevLoggerAsyncOptions;
}> = [
  { label: 'no strategy', options: {} },
  {
    label: 'useFactory + useClass',
    options: { useFactory: () => ({}), useClass: AsyncOptionsFactory },
  },
  {
    label: 'useClass + useExisting',
    options: { useClass: AsyncOptionsFactory, useExisting: AsyncOptionsFactory },
  },
];

const NORMALIZE_CHANNELS_CASES: ReadonlyArray<{
  readonly label: string;
  readonly input: DevLoggerChannels;
  readonly expectedDefault: string;
}> = [
  {
    label: 'array form uses first entry',
    input: [{ name: 'audit' }, { name: 'payment' }],
    expectedDefault: 'audit',
  },
  {
    label: 'explicit ChannelsOptions honors defaultChannel',
    input: { channels: [{ name: 'audit' }, { name: 'payment' }], defaultChannel: 'payment' },
    expectedDefault: 'payment',
  },
  {
    label: 'record form honors default: true',
    input: { audit: {}, payment: { default: true } },
    expectedDefault: 'payment',
  },
  {
    label: 'record form without default selects first entry',
    input: { audit: {}, payment: {} },
    expectedDefault: 'audit',
  },
];

describe('LoggerModule', () => {
  it('exposes stable tokens, LoggerAdapterRegistry, and DevLoggerModule alias', () => {
    expect(DevLoggerModule).toBe(LoggerModule);
    expect(LoggerAdapterRegistry).toBe(AdapterResolver);
    expect(createLoggerToken('check')).toBe(Symbol.for('cisea.logger.check'));
    expect(LoggerModule.forRoot({}).module).toBe(LoggerModule);
  });

  it('starts cleanly with only NestjsLoggerAdapter and rejects unregistered adapters clearly', async () => {
    const transport = captureTransport();
    const validModule = await Test.createTestingModule({
      imports: [LoggerModule.forRoot(baseOptions(transport))],
    }).compile();

    const resolver = validModule.get(AdapterResolver);
    expect(resolver.has('nestjs')).toBe(true);
    expect(resolver.has('pino')).toBe(false);
    expect(resolver.has('winston')).toBe(false);
    await validModule.close();

    await expect(
      Test.createTestingModule({
        imports: [
          LoggerModule.forRoot({
            backend: { type: 'pino', logger: {} },
          }),
        ],
      }).compile(),
    ).rejects.toThrow(AdapterNotFoundException);
  });

  it('supports explicit, class, factory, and async adapter registration with initialize/dispose lifecycle', async () => {
    const events: string[] = [];

    class ClassAdapter implements LoggerAdapter<string[]> {
      readonly name = 'class-adapter';
      initialize(options?: LoggerAdapterOptions): void {
        events.push(`init:${options?.level ?? 'none'}`);
      }
      create(target: string[]): UniversalLogger {
        return {
          debug: (msg) => target.push(`debug:${msg}`),
          log: (msg) => target.push(`log:${msg}`),
          warn: (msg) => target.push(`warn:${msg}`),
          error: (msg) => target.push(`error:${msg}`),
        };
      }
      dispose(): void {
        events.push('dispose:class-adapter');
      }
    }
    Injectable()(ClassAdapter);

    const logBuffer: string[] = [];
    const testingModule = await Test.createTestingModule({
      imports: [
        LoggerModule.forRoot({
          level: 'debug',
          adapters: [
            ClassAdapter,
            {
              name: 'factory-adapter',
              useFactory: () => ({
                name: 'factory-adapter',
                create: () => ({ debug() {}, log() {}, warn() {}, error() {} }),
              }),
            },
          ],
          backend: { type: 'custom', adapter: new ClassAdapter(), logger: logBuffer },
        }),
      ],
    }).compile();

    await testingModule.init();
    const logger = testingModule.get<UniversalLogger>(DEV_LOGGER);
    logger.log('from-custom');
    expect(logBuffer).toEqual(['log:from-custom']);
    expect(testingModule.get(AdapterResolver).has('class-adapter')).toBe(true);
    expect(testingModule.get(AdapterResolver).has('factory-adapter')).toBe(true);
    expect(events).toContain('init:debug');

    await testingModule.close();
    expect(events).toContain('dispose:class-adapter');
  });

  it('supports defaultAdapter selection via adapter name without explicit backend object', async () => {
    const captured: string[] = [];
    const customAdapter: LoggerAdapter = {
      name: 'managed-custom',
      create: () => ({
        debug: (m) => captured.push(`d:${m}`),
        log: (m) => captured.push(`l:${m}`),
        warn: (m) => captured.push(`w:${m}`),
        error: (m) => captured.push(`e:${m}`),
      }),
    };

    const testingModule = await Test.createTestingModule({
      imports: [
        LoggerModule.forRoot({
          adapters: [{ name: 'managed-custom', useValue: customAdapter }],
          defaultAdapter: 'managed-custom',
        }),
      ],
    }).compile();

    testingModule.get<UniversalLogger>(DEV_LOGGER).warn('managed');
    expect(captured).toEqual(['w:managed']);
    await testingModule.close();
  });

  it.each(INVALID_ASYNC_STRATEGY_CASES)('rejects $label in forRootAsync', ({ options }) => {
    expect(() => LoggerModule.forRootAsync(options)).toThrow(InvalidLoggerConfigurationException);
    expect(() => LoggerModule.forRootAsync(options)).toThrow(/exactly one/);
  });

  it('resolves DEV_LOGGER through DI and shares the Nest Logger instance', async () => {
    const transport = captureTransport();
    const testingModule = await Test.createTestingModule({
      imports: [LoggerModule.forRoot(baseOptions(transport))],
    }).compile();

    const logger = testingModule.get<UniversalLoggerImpl>(DEV_LOGGER);
    expect(logger).toBeInstanceOf(UniversalLoggerImpl);
    expect(testingModule.get(Logger)).toBe(logger);
    expect(testingModule.get(LOGGER_OPTIONS)).toEqual(baseOptions(transport));
    expect(testingModule.get(LOG_TRANSPORTS)).toEqual([transport]);
    expect(testingModule.get(LogContextStore)).toBeInstanceOf(LogContextStore);
    expect(testingModule.get(LogPipeline)).toBeInstanceOf(LogPipeline);

    logger.log('hello', { requestId: 'req-1' });
    expect(transport.records).toHaveLength(1);
    expect(transport.records[0]?.message).toBe('hello');
    expect(transport.records[0]?.requestId).toBe('req-1');
    await testingModule.close();
  });

  it('calls lifecycle shutdown once across both hooks', async () => {
    const transport = captureTransport();
    const testingModule = await Test.createTestingModule({
      imports: [LoggerModule.forRoot(baseOptions(transport))],
    }).compile();
    const service = testingModule.get(LifecycleService);
    const manager = testingModule.get(LifecycleManager);
    const shutdown = vi.spyOn(manager, 'shutdown');

    await Promise.all([service.onModuleDestroy(), service.onApplicationShutdown()]);
    await testingModule.close();

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(transport.closeSpy).toHaveBeenCalledTimes(1);
  });

  it.each(NORMALIZE_CHANNELS_CASES)('normalizeChannels: $label', ({ input, expectedDefault }) => {
    const normalized = normalizeChannels(input);
    expect(normalized.defaultChannel).toBe(expectedDefault);
    expect(normalized.unknownChannel).toBe('throw');
  });

  it('wires named channels through forRoot with isolated levels and shared instances', async () => {
    const main = captureTransport();
    const payment = captureTransport();
    const testingModule = await Test.createTestingModule({
      imports: [
        LoggerModule.forRoot({
          channels: {
            main: { level: 'error', transports: [main] },
            payment: { default: true, level: 'debug', transports: [payment] },
          },
        }),
        PaymentFeatureModule,
        MainFeatureModule,
      ],
    }).compile();

    const manager = testingModule.get<LoggerManager<string>>(LOGGER_MANAGER);
    const paymentToken = createChannelLoggerToken('payment');
    const mainToken = createChannelLoggerToken('main');
    const defaultLogger = manager.getLogger();

    expect(testingModule.get(paymentToken)).toBe(defaultLogger);
    expect(testingModule.get(DEV_LOGGER)).toBe(defaultLogger);
    expect(testingModule.get(Logger)).toBe(defaultLogger);
    expect(testingModule.get(PaymentFeature).logger).toBe(defaultLogger);
    expect(testingModule.get(MainFeature).logger).toBe(testingModule.get(mainToken));
    expect(testingModule.get(MainFeature).logger).not.toBe(defaultLogger);
    expect(() => manager.getLogger('missing')).toThrow(UnknownChannelError);

    testingModule.get(PaymentFeature).logger.info('paid');
    testingModule.get(MainFeature).logger.info('skipped');
    await manager.flush();

    expect(payment.records.map((record) => record.message)).toEqual(['paid']);
    expect(main.records).toHaveLength(0);
    await testingModule.close();
  });

  it('supports forRootAsync with injected ConfigService, channels, and forFeature', async () => {
    const appTransport = captureTransport();
    const payTransport = captureTransport();
    const CONFIG = Symbol('CONFIG');

    class ConfigModuleMock {}
    Module({
      providers: [{ provide: CONFIG, useValue: { appLevel: 'info', payLevel: 'debug' } }],
      exports: [CONFIG],
    })(ConfigModuleMock);

    class FeatureConsumer {
      constructor(readonly payLogger: ChannelLogger) {}
    }
    Injectable()(FeatureConsumer);
    (InjectLogger('payment') as ParameterDecorator)(FeatureConsumer, undefined, 0);

    class FeatureConsumerModule {}
    Module({
      imports: [LoggerModule.forFeature(['payment'])],
      providers: [FeatureConsumer],
      exports: [FeatureConsumer],
    })(FeatureConsumerModule);

    const factory = vi.fn((cfg: { appLevel: 'info'; payLevel: 'debug' }) => ({
      channels: {
        app: { default: true, level: cfg.appLevel, transports: [appTransport] },
        payment: { level: cfg.payLevel, transports: [payTransport] },
      },
    }));

    const testingModule = await Test.createTestingModule({
      imports: [
        LoggerModule.forRootAsync({
          imports: [ConfigModuleMock],
          inject: [CONFIG],
          channels: ['app', 'payment'],
          useFactory: factory as (...args: readonly unknown[]) => DevLoggerOptions,
        }),
        FeatureConsumerModule,
      ],
    }).compile();

    expect(factory).toHaveBeenCalledTimes(1);
    testingModule.get(FeatureConsumer).payLogger.debug('payment debug');
    testingModule.get<ChannelLogger>(DEV_LOGGER).debug('filtered out on app');
    testingModule.get<ChannelLogger>(DEV_LOGGER).info('kept on app');

    expect(payTransport.records.map((r) => r.message)).toEqual(['payment debug']);
    expect(appTransport.records.map((r) => r.message)).toEqual(['kept on app']);
    await testingModule.close();
  });

  it('supports forRootAsync with useClass and useExisting for single-logger and channels', async () => {
    const classTransport = captureTransport();
    const existingChannelTransport = captureTransport();
    const EXTRA = Symbol('EXTRA');

    class ConfigProviderModule {}
    Module({
      providers: [{ provide: EXTRA, useValue: 'audit' }],
      exports: [EXTRA],
    })(ConfigProviderModule);

    class ClassChannelFactory implements DevLoggerOptionsFactory {
      constructor(readonly channelName: string) {}
      createDevLoggerOptions(): DevLoggerOptions {
        return {
          channels: {
            [this.channelName]: { default: true, transports: [classTransport] },
          },
        };
      }
    }
    Injectable()(ClassChannelFactory);
    (Inject(EXTRA) as ParameterDecorator)(ClassChannelFactory, undefined, 0);

    const classModule = await Test.createTestingModule({
      imports: [
        LoggerModule.forRootAsync({
          imports: [ConfigProviderModule],
          channels: ['audit'],
          useClass: ClassChannelFactory,
        }),
      ],
    }).compile();

    classModule.get<ChannelLogger>(createChannelLoggerToken('audit')).info('via useClass');
    expect(classTransport.records.map((r) => r.message)).toEqual(['via useClass']);
    await classModule.close();

    class ExistingChannelFactory implements DevLoggerOptionsFactory {
      createDevLoggerOptions(): DevLoggerOptions {
        return { channels: [{ name: 'jobs', transports: [existingChannelTransport] }] };
      }
    }
    class ExistingModule {}
    Module({
      providers: [ExistingChannelFactory],
      exports: [ExistingChannelFactory],
    })(ExistingModule);

    const existingModule = await Test.createTestingModule({
      imports: [
        LoggerModule.forRootAsync({
          imports: [ExistingModule],
          channels: ['jobs'],
          useExisting: ExistingChannelFactory,
        }),
      ],
    }).compile();

    existingModule.get<ChannelLogger>(createChannelLoggerToken('jobs')).warn('via useExisting');
    expect(existingChannelTransport.records.map((r) => r.message)).toEqual(['via useExisting']);
    await existingModule.close();

    const singleExisting = await Test.createTestingModule({
      imports: [
        LoggerModule.forRootAsync({
          imports: [OptionsModule],
          useExisting: ExistingOptionsFactory,
        }),
      ],
    }).compile();
    singleExisting.get<UniversalLogger>(DEV_LOGGER).info?.('existing single');
    expect(existingTransport.records.map((r) => r.message)).toContain('existing single');
    await singleExisting.close();
  });

  it('captures real NestFactory bootstrap logs with bufferLogs and useLogger, and closes on app.close()', async () => {
    const transport = captureTransport();

    class SampleService {
      private readonly nestLogger = new Logger('SampleService');
      run(): void {
        this.nestLogger.log('service log');
        this.nestLogger.error(
          'service fail',
          'Error: fail\n    at run (sample.ts:1:1)',
          'SampleService',
        );
      }
    }
    Injectable()(SampleService);

    class BootstrapModule {}
    Module({
      imports: [LoggerModule.forRoot({ level: 'verbose', transports: [transport] })],
      providers: [SampleService],
    })(BootstrapModule);

    const app = await NestFactory.createApplicationContext(BootstrapModule, { bufferLogs: true });
    app.useLogger(app.get(DEV_LOGGER));
    app.get(SampleService).run();
    await app.close();

    expect(transport.closeSpy).toHaveBeenCalledTimes(1);
    const messages = transport.records.map((record) => record.message);
    expect(messages).toContain('service log');
    expect(messages).toContain('service fail');
    expect(transport.records.some((record) => record.context === 'InstanceLoader')).toBe(true);
    const errorRecord = transport.records.find((record) => record.message === 'service fail');
    expect(errorRecord?.context).toBe('SampleService');
    expect(errorRecord?.error?.stack).toContain('at run');
  });

  it('routes native LoggerService severity methods through app.useLogger()', async () => {
    const transport = captureTransport();

    class SeverityService {
      private readonly nestLogger = new Logger('SeverityService');
      run(): void {
        this.nestLogger.verbose('sev verbose');
        this.nestLogger.debug('sev debug');
        this.nestLogger.warn('sev warn');
        this.nestLogger.error('sev error');
        this.nestLogger.fatal('sev fatal');
      }
    }
    Injectable()(SeverityService);

    class SeverityModule {}
    Module({
      imports: [LoggerModule.forRoot({ level: 'trace', transports: [transport] })],
      providers: [SeverityService],
    })(SeverityModule);

    const app = await NestFactory.createApplicationContext(SeverityModule, { bufferLogs: true });
    const injected = app.get(DEV_LOGGER);
    expect(injected).toBe(app.get(Logger));
    app.useLogger(injected);
    app.get(SeverityService).run();
    await app.close();

    const levels = new Map(transport.records.map((record) => [record.message, record.level]));
    expect(levels.get('sev verbose')).toBe('verbose');
    expect(levels.get('sev debug')).toBe('debug');
    expect(levels.get('sev warn')).toBe('warn');
    expect(levels.get('sev error')).toBe('error');
    expect(levels.get('sev fatal')).toBe('fatal');
  });
});
