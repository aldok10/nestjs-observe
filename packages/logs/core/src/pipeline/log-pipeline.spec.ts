import { describe, expect, it, vi } from 'vitest';
import type { LogFormatter, LogRecord, LogTransport } from '../contracts/index.js';
import { createLogRecord } from '../record/index.js';
import { InMemoryCaptureTransport as CaptureTransport } from '../test-capture.transport.js';
import { LogPipeline } from './index.js';

function createTestRecord(metadata?: Record<string, unknown>): LogRecord {
  return createLogRecord({
    level: 'info',
    message: 'hello',
    ...(metadata === undefined ? {} : { context: { metadata } }),
  });
}

describe('LogPipeline', () => {
  describe('emit', () => {
    it('delivers to every transport and isolates failures', async () => {
      const capture = new CaptureTransport('ok');
      const failing: LogTransport = {
        name: 'fail',
        write() {
          throw new Error('boom');
        },
      };
      const errors: string[] = [];
      const pipeline = new LogPipeline({
        transports: [capture, failing],
        onTransportError: (name) => errors.push(name),
      });

      await expect(pipeline.emit(createTestRecord())).resolves.toBeUndefined();

      expect(capture.records).toHaveLength(1);
      expect(errors).toEqual(['fail']);
      const [healthy, broken] = pipeline.health();
      expect(healthy?.sent).toBe(1);
      expect(broken?.failed).toBe(1);
      expect(broken?.lastError).toBe('boom');
    });

    it('redacts the whole record, including message, error and cause', async () => {
      const capture = new CaptureTransport();
      const pipeline = new LogPipeline({
        transports: [capture],
        redaction: {
          matchers: [(key) => key === 'message' || key === 'stack' || key === 'token'],
        },
      });
      const input: LogRecord = {
        schemaVersion: 1,
        timestamp: 1,
        level: 'error',
        message: 'hello',
        metadata: { token: 'abc' },
        error: {
          name: 'Error',
          message: 'boom',
          stack: 'trace',
          cause: { token: 'nested' },
        },
      };

      await expect(pipeline.emit(input)).resolves.toBeUndefined();

      const delivered = capture.records[0];
      expect(delivered?.message).toBe('[REDACTED]');
      expect(delivered?.metadata?.['token']).toBe('[REDACTED]');
      expect(delivered?.error?.stack).toBe('[REDACTED]');
      expect((delivered?.error?.cause as Record<string, unknown> | undefined)?.['token']).toBe(
        '[REDACTED]',
      );
      expect(input.message).toBe('hello');
    });

    it('keeps delivery non-throwing when a redaction matcher throws', async () => {
      const capture = new CaptureTransport();
      const pipeline = new LogPipeline({
        transports: [capture],
        redaction: {
          matchers: [
            () => {
              throw new Error('bad matcher');
            },
          ],
        },
      });

      await expect(pipeline.emit(createTestRecord())).resolves.toBeUndefined();
      expect(capture.records).toHaveLength(1);
    });

    it('leaves formatting to transports and delivers once to each', async () => {
      const format = vi.fn(() => 'line');
      const shared: LogFormatter = { format };
      const write = vi.fn();
      const pipeline = new LogPipeline({
        format: shared,
        transports: [
          { name: 'a', write },
          { name: 'b', write: vi.fn() },
        ],
      });

      await pipeline.emit(createTestRecord());

      expect(format).not.toHaveBeenCalled();
      expect(write).toHaveBeenCalledTimes(1);
    });
  });

  describe('close & health', () => {
    it('close is idempotent and stops delivery', async () => {
      const capture = new CaptureTransport();
      const pipeline = new LogPipeline({ transports: [capture] });
      const closing = pipeline.close();
      expect(pipeline.close()).toBe(closing);
      await closing;
      await pipeline.emit(createTestRecord());
      expect(capture.records).toHaveLength(0);
    });

    it('close waits for in-flight writes before closing transports', async () => {
      const events: string[] = [];
      const transport: LogTransport = {
        name: 'slow',
        async write() {
          await new Promise((resolve) => setTimeout(resolve, 20));
          events.push('write');
        },
        async close() {
          events.push('close');
        },
      };
      const pipeline = new LogPipeline({ transports: [transport] });

      const emitting = pipeline.emit(createTestRecord());
      const closing = pipeline.close();
      await Promise.all([emitting, closing]);

      expect(events).toEqual(['write', 'close']);
    });

    it('sanitizes transport error messages stored in health', async () => {
      const transport: LogTransport = {
        name: 'failing',
        write() {
          throw new Error('password=hunter2');
        },
      };
      const pipeline = new LogPipeline({ transports: [transport] });
      await pipeline.emit(createTestRecord());
      expect(pipeline.health()[0]?.lastError).toBe('[REDACTED]');
      expect(JSON.stringify(pipeline.health())).not.toContain('hunter2');
    });

    it('health recovers after success while keeping cumulative failures', async () => {
      let shouldFail = true;
      const transport: LogTransport = {
        name: 'flaky',
        write() {
          if (shouldFail) {
            shouldFail = false;
            throw new Error('boom');
          }
        },
      };
      const pipeline = new LogPipeline({ transports: [transport] });

      await pipeline.emit(createTestRecord());
      expect(pipeline.health()[0]?.status).toBe('degraded');
      await pipeline.emit(createTestRecord());
      expect(pipeline.health()[0]?.status).toBe('healthy');
      expect(pipeline.health()[0]?.failed).toBe(1);
    });
  });
});
