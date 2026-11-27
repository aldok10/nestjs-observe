import { describe, expect, it } from 'vitest';
import type { LogRecord, LogTransport } from '@aldok10/nestjs-observe-logger-core/contracts';

export interface TransportContractCase {
  readonly name: string;
  readonly transport: LogTransport;
  readonly record: LogRecord;
}

/** Close idempotency is asserted by effect, never by promise identity. */
export function runTransportContract({ name, transport, record }: TransportContractCase): void {
  describe(`${name} transport contract`, () => {
    it('writes, flushes, reports health and ignores writes after close', async () => {
      expect(typeof transport.name).toBe('string');
      void transport.write(record);
      await transport.flush?.();

      await transport.close?.();
      await transport.close?.();

      const afterClose = transport.health?.();
      void transport.write(record);
      await transport.flush?.();
      if (afterClose !== undefined) {
        expect(afterClose.sent).toBeGreaterThanOrEqual(1);
        expect(transport.health?.().queued ?? 0).toBe(afterClose.queued);
      }
    });
  });
}
