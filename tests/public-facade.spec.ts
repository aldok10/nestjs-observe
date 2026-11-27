import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as main from '@aldok10/nestjs-observe-logger';
import * as nestjs from '@aldok10/nestjs-observe-logger/nestjs';
import * as channels from '@aldok10/nestjs-observe-logger/channels';
import * as transports from '@aldok10/nestjs-observe-logger/transports';
import * as contracts from '@aldok10/nestjs-observe-logger/contracts';
import * as exceptions from '@aldok10/nestjs-observe-logger/exceptions';
import * as context from '@aldok10/nestjs-observe-logger/context';
import * as pipeline from '@aldok10/nestjs-observe-logger/pipeline';
import * as resolver from '@aldok10/nestjs-observe-logger/resolver';
import * as lifecycle from '@aldok10/nestjs-observe-logger/lifecycle';
import * as record from '@aldok10/nestjs-observe-logger/record';
import * as redaction from '@aldok10/nestjs-observe-logger/redaction';
import * as formatters from '@aldok10/nestjs-observe-logger/formatters';

const packageDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'packages',
  'logs',
  'logger',
);

const UNSAFE_EXPORTS = [
  'PinoLoggerAdapter',
  'WinstonLoggerAdapter',
  'BunyanLoggerAdapter',
  'Log4jsLoggerAdapter',
  'BufferedRemoteTransport',
  'HttpTransport',
  'LokiTransport',
  'OpenObserveTransport',
  'ElasticsearchTransport',
  'OtlpLogTransport',
  'StreamTransport',
  'ConsoleTransport',
];

const OPTIONAL_PEERS = [
  'pino',
  'winston',
  'bunyan',
  'log4js',
  '@opentelemetry/api',
  'express',
  'fastify',
  'rotating-file-stream',
  '@sentry/node',
];

describe('public facade', () => {
  it('resolves canonical targets and every published subpath', () => {
    expect(main.ObserveLoggerModule).toBe(main.LoggerModule);
    expect(nestjs.ObserveLoggerModule).toBe(nestjs.LoggerModule);
    expect(main.NestjsAdapter).toBe(main.NestjsLoggerAdapter);
    expect(nestjs.NestjsAdapter).toBe(nestjs.NestjsLoggerAdapter);

    expect(channels.createLoggerToken('x')).toBe('LOGGER_CHANNEL:x');
    expect(typeof main.createLoggerToken('x')).toBe('symbol');
    expect(channels.createLoggerToken).not.toBe(main.createLoggerToken);

    expect(typeof main.LoggerModule).toBe('function');
    expect(typeof channels.createLoggerManager).toBe('function');
    expect(typeof transports.ConsoleTransport).toBe('function');
    expect(Array.isArray(contracts.LOG_LEVELS)).toBe(true);
    expect(typeof exceptions.InvalidLoggerConfigurationException).toBe('function');
    expect(typeof context.LogContextStore).toBe('function');
    expect(typeof pipeline.LogPipeline).toBe('function');
    expect(typeof resolver.AdapterResolver).toBe('function');
    expect(typeof lifecycle.LifecycleManager).toBe('function');
    expect(typeof record.createLogRecord).toBe('function');
    expect(typeof redaction.RedactionEngine).toBe('function');
    expect(typeof formatters.registerFormatter).toBe('function');
  });

  it('does not expose adapters, transports or formatters from the root', () => {
    for (const module of [main, nestjs]) {
      for (const name of UNSAFE_EXPORTS) expect(name in module).toBe(false);
    }
  });

  it('loads no optional peer when the built root entry is required', () => {
    const script = `
      require(${JSON.stringify(resolve(packageDir, 'dist', 'index.cjs'))});
      const peers = ${JSON.stringify(OPTIONAL_PEERS)};
      const hits = Object.keys(require.cache).filter((file) =>
        peers.some((name) => file.includes('node_modules/' + name + '/')),
      );
      process.stdout.write(JSON.stringify(hits));
    `;
    const output = execFileSync(process.execPath, ['-e', script], {
      cwd: packageDir,
      encoding: 'utf8',
    });
    expect(JSON.parse(output)).toEqual([]);
  });
});
