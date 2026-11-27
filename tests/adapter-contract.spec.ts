import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { LogRecord } from '@aldok10/nestjs-observe-logger-core/contracts';
import {
  BunyanLoggerAdapter,
  type BunyanLike,
} from '@aldok10/nestjs-observe-logger-adapter-bunyan';
import {
  Log4jsLoggerAdapter,
  type Log4jsLike,
} from '@aldok10/nestjs-observe-logger-adapter-log4js';
import { PinoLoggerAdapter } from '@aldok10/nestjs-observe-logger-adapter-pino';
import { WinstonLoggerAdapter } from '@aldok10/nestjs-observe-logger-adapter-winston';
import { runAdapterContract } from './helpers/adapter-contract.js';

function backendStub(): object {
  const noop = (): void => undefined;
  const stub: Record<string, unknown> = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    level: 'trace',
  };
  stub['child'] = () => stub;
  return stub;
}

const CASES = [
  { name: 'pino', adapter: new PinoLoggerAdapter() },
  { name: 'winston', adapter: new WinstonLoggerAdapter() },
  { name: 'bunyan', adapter: new BunyanLoggerAdapter() },
  { name: 'log4js', adapter: new Log4jsLoggerAdapter() },
] as const;

for (const { name, adapter } of CASES) {
  runAdapterContract({ name, adapter, backendStub: backendStub() });
}

const nodeRequire = createRequire(import.meta.url);
function installed(specifier: string): boolean {
  try {
    nodeRequire.resolve(specifier);
    return true;
  } catch {
    return false;
  }
}

const HAS_BUNYAN = installed('bunyan');
const HAS_LOG4JS = installed('log4js');

describe('real backend smoke (conditional)', () => {
  it.skipIf(!HAS_BUNYAN)('bunyan real instance delivers one sink record', async () => {
    const specifier = 'bunyan';
    const mod = (await import(specifier)) as {
      createLogger(options: object): BunyanLike;
    };
    const records: LogRecord[] = [];
    const logger = new BunyanLoggerAdapter().create(
      mod.createLogger({
        name: 'smoke',
        level: 'trace',
        streams: [{ level: 'trace', stream: new PassThrough() }],
      }),
      {
        level: 'trace',
        sink: (record) => {
          records.push(record);
        },
        ownership: 'package',
      },
    );
    logger.info?.('bunyan real');
    expect(records[0]).toMatchObject({ level: 'info', message: 'bunyan real' });
  });

  it.skipIf(!HAS_LOG4JS)('log4js real instance delivers one sink record', async () => {
    const specifier = 'log4js';
    const mod = (await import(specifier)) as {
      configure(options: object): void;
      getLogger(name: string): Log4jsLike;
    };
    mod.configure({
      appenders: { out: { type: 'stdout' } },
      categories: { default: { appenders: ['out'], level: 'trace' } },
    });
    const records: LogRecord[] = [];
    const logger = new Log4jsLoggerAdapter().create(mod.getLogger('smoke'), {
      level: 'trace',
      sink: (record) => {
        records.push(record);
      },
      ownership: 'package',
    });
    logger.info?.('log4js real');
    expect(records[0]).toMatchObject({ level: 'info', message: 'log4js real' });
  });
});
