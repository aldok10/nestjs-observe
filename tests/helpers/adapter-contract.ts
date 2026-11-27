import { describe, expect, it } from 'vitest';
import type {
  AdapterCapabilities,
  LogRecord,
  UniversalLogger,
} from '@aldok10/nestjs-observe-logger-core/contracts';

type ContractAdapter = {
  readonly name: string;
  readonly capabilities?: Partial<AdapterCapabilities>;
  create(
    backend: object,
    options: {
      level: 'trace';
      sink: (record: LogRecord) => void;
      ownership: 'package';
    },
  ): UniversalLogger;
};

export interface AdapterContractCase {
  readonly name: 'pino' | 'winston' | 'bunyan' | 'log4js';
  readonly adapter: unknown;
  readonly backendStub: object;
}

const CAPABILITY_KEYS = [
  'structuredMetadata',
  'childLoggers',
  'contextBinding',
  'dynamicLogLevels',
  'nativeTransports',
  'redaction',
  'serialization',
  'flush',
  'gracefulShutdown',
] as const;

/** Backend-agnostic contract shared by the four logging-backend adapters. */
export function runAdapterContract({ name, adapter, backendStub }: AdapterContractCase): void {
  const subject = adapter as ContractAdapter;

  describe(`${name} adapter contract`, () => {
    it('exposes create, a stable name and all nine capability flags', () => {
      expect(typeof subject.create).toBe('function');
      expect(subject.name).toBe(name);
      for (const key of CAPABILITY_KEYS) {
        expect(typeof subject.capabilities?.[key]).toBe('boolean');
      }
      expect(subject.capabilities).toMatchObject({
        contextBinding: true,
        redaction: true,
        flush: false,
        gracefulShutdown: false,
      });
    });

    it('delivers one sink record per call with the matching level and message', () => {
      const records: LogRecord[] = [];
      const logger = subject.create(backendStub, {
        level: 'trace',
        sink: (record) => {
          records.push(record);
        },
        ownership: 'package',
      });

      expect(typeof logger.log).toBe('function');
      expect(typeof logger.error).toBe('function');
      if (subject.capabilities?.childLoggers === true) {
        expect(typeof (logger as UniversalLogger & { child?: unknown }).child).toBe('function');
      }

      logger.info?.('x');
      logger.error?.('x');

      expect(records).toHaveLength(2);
      expect(records[0]).toMatchObject({ level: 'info', message: 'x' });
      expect(records[1]).toMatchObject({ level: 'error', message: 'x' });
    });
  });
}
