import {
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  LogFormatter,
  LogLevel,
  LogRecord,
  LogTransport,
  TransportHealth,
} from '../contracts/index.js';
import {
  ChannelNotFoundException,
  DuplicateChannelException,
  LoggerException,
} from '../exceptions/index.js';
import { createLogRecord } from '../record/index.js';
import { InMemoryCaptureTransport as CaptureTransport } from '../test-capture.transport.js';
import {
  ChannelRegistry,
  ChannelRouter,
  TransportManager,
  UnknownChannelError,
  createLoggerManager,
  resolveChannel,
  type UnknownChannelPolicy,
} from './index.js';
// Regression proof: core works with custom transports and no format package installed.
const createFileTransport = (path: string, channelFormatter?: LogFormatter): LogTransport => {
  const resolvedPath = path.replaceAll('{pid}', String(process.pid));
  mkdirSync(dirname(resolvedPath), { recursive: true });
  const stream = createWriteStream(resolvedPath, { flags: 'a' });
  const formatter: LogFormatter = channelFormatter ?? {
    format: (record: LogRecord) => JSON.stringify({ level: record.level, message: record.message }),
  };
  return {
    name: 'stream',
    write(record) {
      const formatted = formatter.format(record);
      const line =
        typeof formatted === 'string'
          ? `${formatted}\n`
          : Buffer.concat([formatted, Buffer.from('\n')]);
      stream.write(line);
    },
    async close() {
      await new Promise<void>((resolve) => stream.end(() => resolve()));
    },
  } satisfies LogTransport;
};

class FailingTransport implements LogTransport {
  readonly name = 'failing';
  write(): void {
    throw new Error('boom');
  }
  async close(): Promise<void> {}
}

class QueueTransport implements LogTransport {
  readonly name = 'queue';
  readonly queued: LogRecord[] = [];
  dropped = 0;
  flushCalls = 0;
  sent = 0;

  constructor(
    private readonly capacity = 1,
    private readonly drainOnFlush = false,
  ) {}

  write(record: LogRecord): void {
    if (this.queued.length >= this.capacity) {
      this.dropped += 1;
      return;
    }
    this.queued.push(record);
  }

  async flush(): Promise<void> {
    this.flushCalls += 1;
    if (this.drainOnFlush) this.sent += this.queued.splice(0).length;
  }

  health(): TransportHealth {
    return {
      name: this.name,
      status: 'healthy',
      healthy: true,
      queued: this.queued.length,
      capacity: this.capacity,
      dropped: this.dropped,
      sent: this.sent,
      failed: 0,
    };
  }

  async close(): Promise<void> {}
}

class CountingTransport implements LogTransport {
  readonly name = 'counting';
  closeCount = 0;
  write(): void {}
  async close(): Promise<void> {
    this.closeCount += 1;
  }
}

const CHANNEL_LEVEL_FILTER_CASES: ReadonlyArray<{
  readonly threshold: LogLevel;
  readonly expectedMessages: readonly string[];
}> = [
  { threshold: 'trace', expectedMessages: ['trace', 'debug', 'verbose', 'info', 'warn', 'error'] },
  { threshold: 'info', expectedMessages: ['info', 'warn', 'error'] },
  { threshold: 'error', expectedMessages: ['error'] },
];

const UNKNOWN_CHANNEL_POLICY_CASES: ReadonlyArray<{
  readonly policy: UnknownChannelPolicy;
}> = [{ policy: 'throw' }, { policy: 'drop' }, { policy: 'create' }];

describe('ChannelManager & ChannelRegistry', () => {
  describe('ChannelRegistry', () => {
    it('throws ChannelNotFoundException on missing names and DuplicateChannelException on re-register', () => {
      const registry = new ChannelRegistry<string>([
        resolveChannel({ name: 'main', transports: [] }),
      ]);
      expect(registry.has('main')).toBe(true);
      expect(() => registry.get('other')).toThrow(ChannelNotFoundException);
      expect(() => registry.register(resolveChannel({ name: 'main', transports: [] }))).toThrow(
        DuplicateChannelException,
      );
    });
  });

  describe('LoggerManager', () => {
    it('enables every level when a channel has no configured level', async () => {
      const capture = new CaptureTransport('audit');
      const manager = createLoggerManager({ channels: [{ name: 'audit', transports: [capture] }] });
      const logger = manager.getLogger('audit');

      logger.trace('trace');
      logger.debug('debug');
      logger.verbose('verbose');
      logger.info('info');
      await manager.flush();

      expect(capture.records.map((record) => record.message)).toEqual([
        'trace',
        'debug',
        'verbose',
        'info',
      ]);
    });

    it.each(CHANNEL_LEVEL_FILTER_CASES)(
      'filters channel logs at threshold="$threshold"',
      async ({ threshold, expectedMessages }) => {
        const capture = new CaptureTransport('audit');
        const manager = createLoggerManager({
          channels: [{ name: 'audit', level: threshold, transports: [capture] }],
        });
        const logger = manager.getLogger('audit');

        logger.trace('trace');
        logger.debug('debug');
        logger.verbose('verbose');
        logger.info('info');
        logger.warn('warn');
        logger.error('error');
        await manager.flush();

        expect(capture.records.map((record) => record.message)).toEqual(expectedMessages);
      },
    );

    it('keeps named channels isolated with a stable default', async () => {
      const audit = new CaptureTransport('audit');
      const trace = new CaptureTransport('trace');
      const manager = createLoggerManager({
        channels: [
          { name: 'audit', level: 'error', transports: [audit] },
          { name: 'trace', level: 'trace', transports: [trace] },
        ],
        defaultChannel: 'audit',
      });

      manager.getLogger('audit').info('skipped');
      manager.getLogger('trace').debug('kept');
      await manager.flush();

      expect(audit.records).toHaveLength(0);
      expect(trace.records.map((record) => record.message)).toEqual(['kept']);
      expect(manager.getLogger()).toBe(manager.getLogger('audit'));
      expect(manager.getLogger('trace')).toBe(manager.getLogger('trace'));
    });

    it('writes to dedicated {pid} files with per-channel formats', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'cisea-channels-'));
      try {
        const manager = createLoggerManager({
          channels: [
            {
              name: 'audit',
              transports: [
                createFileTransport(join(dir, 'audit-{pid}.log'), {
                  format: (record) =>
                    JSON.stringify({ level: record.level, message: record.message }),
                }),
              ],
            },
            {
              name: 'plain',
              transports: [
                createFileTransport(join(dir, 'plain-{pid}.log'), {
                  format: (record) => `${record.level.toUpperCase()} ${record.message}`,
                }),
              ],
            },
          ],
          defaultChannel: 'audit',
        });

        manager.getLogger('audit').info('json line');
        manager.getLogger('plain').info('text line');
        await manager.shutdown();

        const files = readdirSync(dir);
        expect(files).toContain(`audit-${process.pid}.log`);
        expect(files).toContain(`plain-${process.pid}.log`);
        expect(files.some((file) => file.includes('{pid}'))).toBe(false);
        const json = readFileSync(join(dir, `audit-${process.pid}.log`), 'utf8');
        const text = readFileSync(join(dir, `plain-${process.pid}.log`), 'utf8');
        expect(json).toContain('"level":"info"');
        expect(text).toContain('INFO text line');
        expect(text.startsWith('{')).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('fans out deterministically without duplicates or route cycles', async () => {
      const origin = new CaptureTransport('origin');
      const audit = new CaptureTransport('audit');
      const metrics = new CaptureTransport('metrics');
      const manager = createLoggerManager({
        channels: [
          {
            name: 'main',
            transports: [origin],
            routes: [{ to: 'audit' }, { to: 'metrics' }, { to: 'audit' }],
          },
          { name: 'audit', transports: [audit], routes: [{ to: 'main' }] },
          { name: 'metrics', transports: [metrics] },
        ],
      });

      manager.getLogger('main').info('fan');
      await manager.flush();

      expect(origin.records).toHaveLength(1);
      expect(audit.records).toHaveLength(1);
      expect(metrics.records).toHaveLength(1);
    });

    it('applies route predicates using the active context and record', async () => {
      const audit = new CaptureTransport('audit');
      const errors = new CaptureTransport('errors');
      const manager = createLoggerManager({
        channels: [
          {
            name: 'main',
            transports: [],
            routes: [
              { to: 'audit', when: (_record, context) => context.metadata?.['flag'] === true },
              { to: 'errors', when: (record) => record.level === 'error' },
            ],
          },
          { name: 'audit', transports: [audit] },
          { name: 'errors', transports: [errors] },
        ],
      });
      const logger = manager.getLogger('main');

      manager.run({ metadata: { flag: true } }, () => logger.info('flagged'));
      logger.error('bad');
      await manager.flush();

      expect(audit.records.map((record) => record.message)).toEqual(['flagged']);
      expect(errors.records.map((record) => record.message)).toEqual(['bad']);
    });

    it.each(UNKNOWN_CHANNEL_POLICY_CASES)(
      'applies unknownChannel="$policy" policy',
      async ({ policy }) => {
        const main = new CaptureTransport('main');
        const created = new CaptureTransport('created');
        const manager = createLoggerManager({
          channels: [{ name: 'main', transports: [main] }],
          unknownChannel: policy,
          ...(policy === 'create'
            ? { onUnknownChannel: (name) => ({ name, transports: [created] }) }
            : {}),
        });

        if (policy === 'throw') {
          expect(() => manager.getLogger('missing')).toThrow(UnknownChannelError);
          return;
        }

        const logger = manager.getLogger('missing');
        logger.info('event');
        await manager.flush();

        expect(main.records).toHaveLength(0);
        if (policy === 'drop') {
          expect(created.records).toHaveLength(0);
        } else {
          expect(logger).toBe(manager.getLogger('missing'));
          expect(created.records.map((record) => record.message)).toEqual(['event']);
        }
      },
    );

    it('skips disabled channels', async () => {
      const disabled = new CaptureTransport('disabled');
      const manager = createLoggerManager({
        channels: [
          { name: 'main', transports: [] },
          { name: 'disabled', enabled: false, transports: [disabled] },
        ],
        defaultChannel: 'main',
      });
      manager.getLogger('disabled').info('ignored');
      await manager.flush();
      expect(disabled.records).toHaveLength(0);
    });

    it('isolates concurrent async contexts', async () => {
      const capture = new CaptureTransport('audit');
      const manager = createLoggerManager({ channels: [{ name: 'audit', transports: [capture] }] });
      const logger = manager.getLogger('audit');

      await Promise.all([
        manager.run({ traceId: 'one', metadata: { tenant: 'a' } }, async () => {
          logger.info('a');
          await Promise.resolve();
          expect(manager.context.get().traceId).toBe('one');
        }),
        manager.run({ traceId: 'two', metadata: { tenant: 'b' } }, async () => {
          logger.info('b');
          await Promise.resolve();
          expect(manager.context.get().traceId).toBe('two');
        }),
      ]);
      await manager.flush();

      expect(
        capture.records
          .map((record) => record.traceId)
          .toSorted((a, b) => String(a).localeCompare(String(b))),
      ).toEqual(['one', 'two']);
      expect(
        capture.records
          .map((record) => record.metadata?.['tenant'])
          .toSorted((a, b) => String(a).localeCompare(String(b))),
      ).toEqual(['a', 'b']);
    });

    it('redacts metadata before filters and transports see the record', async () => {
      const capture = new CaptureTransport('audit');
      let seenByFilter: unknown;
      const manager = createLoggerManager({
        channels: [
          {
            name: 'audit',
            transports: [capture],
            filters: [
              (record) => {
                seenByFilter = record.metadata?.['password'];
                return true;
              },
            ],
          },
        ],
      });

      manager.getLogger('audit').info('secret here', { metadata: { password: 'hunter2' } });
      await manager.flush();

      expect(seenByFilter).toBe('[REDACTED]');
      expect(capture.records[0]?.metadata?.['password']).toBe('[REDACTED]');
    });

    it('keeps healthy transports working when one transport throws', async () => {
      const capture = new CaptureTransport('audit');
      const manager = createLoggerManager({
        channels: [{ name: 'audit', transports: [new FailingTransport(), capture] }],
      });

      manager.getLogger('audit').info('still delivered');
      await manager.flush();

      expect(capture.records.map((record) => record.message)).toEqual(['still delivered']);
      expect(manager.health().find((health) => health.name === 'failing')?.failed).toBeGreaterThan(
        0,
      );
    });

    it('flushes the channel pipeline from the logger and its children', async () => {
      const queue = new QueueTransport(10, true);
      const manager = createLoggerManager({ channels: [{ name: 'audit', transports: [queue] }] });
      const logger = manager.getLogger('audit');

      logger.info('first');
      expect(queue.queued).toHaveLength(1);
      await logger.flush();
      expect(queue.flushCalls).toBe(1);
      expect(queue.queued).toHaveLength(0);

      const child = logger.child({ context: 'child' });
      child.info('second');
      await child.flush();

      expect(queue.flushCalls).toBe(2);
      expect(queue.queued).toHaveLength(0);
      expect(queue.sent).toBe(2);
    });

    it('reports bounded transport drops through health', async () => {
      const queue = new QueueTransport(1);
      const manager = createLoggerManager({ channels: [{ name: 'audit', transports: [queue] }] });
      const logger = manager.getLogger('audit');
      logger.info('one');
      logger.info('two');
      await manager.flush();

      expect(queue.queued).toHaveLength(1);
      expect(queue.dropped).toBe(1);
      expect(manager.health().find((health) => health.name === 'queue')?.dropped).toBe(1);
    });

    it('bounds router identities and counts evictions without throwing', async () => {
      const capture = new CaptureTransport('audit');
      const registry = new ChannelRegistry<string>([
        resolveChannel({ name: 'audit', transports: [capture] }),
      ]);
      const transports = new TransportManager<string>();
      transports.build(registry.get('audit'));
      const router = new ChannelRouter(registry, transports.pipelines(), { maxIdentities: 2 });
      const base = createLogRecord({ level: 'log', message: 'base' });

      for (const timestamp of [1, 2, 3]) {
        router.route({ origin: 'audit', record: { ...base, timestamp }, context: {} });
      }
      await transports.flush();
      expect(capture.records).toHaveLength(3);
      expect(router.droppedIdentities).toBe(1);

      router.route({ origin: 'audit', record: { ...base, timestamp: 1 }, context: {} });
      router.route({ origin: 'audit', record: base, context: {} });
      await transports.flush();
      expect(capture.records).toHaveLength(5);
      expect(router.droppedIdentities).toBe(3);
    });

    it('registers channels dynamically and shuts down idempotently', async () => {
      const primary = new CountingTransport();
      const dynamic = new CountingTransport();
      const manager = createLoggerManager({ channels: [{ name: 'main', transports: [primary] }] });

      const logger = manager.registerChannel({ name: 'extra', transports: [dynamic] });
      logger.info('dynamic');
      await manager.flush();
      expect(manager.registry.has('extra')).toBe(true);
      expect(manager.health().filter((health) => health.name === 'counting')).toHaveLength(2);

      await Promise.all([manager.shutdown(), manager.shutdown()]);
      expect(primary.closeCount).toBe(1);
      expect(dynamic.closeCount).toBe(1);
      expect(() => manager.registerChannel({ name: 'late' })).toThrow(LoggerException);
    });
  });
});
