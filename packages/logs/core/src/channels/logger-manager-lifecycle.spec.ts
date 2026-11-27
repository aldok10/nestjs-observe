import { describe, expect, it, vi } from 'vitest';
import type { LogTransport } from '../contracts/index.js';
import { createLoggerManager } from './index.js';

class CloseSpyTransport implements LogTransport {
  readonly name = 'close-spy';
  readonly closeSpy = vi.fn(async () => undefined);

  write(): void {}

  async close(): Promise<void> {
    await this.closeSpy();
  }
}

describe('LoggerManager startup failure', () => {
  it('rolls back owned transports built before the failure', async () => {
    const transport = new CloseSpyTransport();
    expect(() =>
      createLoggerManager({
        channels: [{ name: 'main', transports: [transport] }],
        defaultChannel: 'missing',
      }),
    ).toThrow(/missing/);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(transport.closeSpy).toHaveBeenCalledTimes(1);
  });
});
