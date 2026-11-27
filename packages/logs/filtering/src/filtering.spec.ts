import { describe, expect, it, vi } from 'vitest';
import type { LogRecord } from '@aldok10/nestjs-observe-logger-core/contracts';
import { FilterEngine } from '@aldok10/nestjs-observe-logger-core';
import {
  byContext,
  channelFilter,
  composeFilters,
  excludeLevels,
  levelAtLeast,
  sample,
} from './index.js';

function record(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    schemaVersion: 1,
    timestamp: 1_700_000_000_000,
    level: 'info',
    message: 'hello',
    ...overrides,
  };
}

const engine = new FilterEngine();

describe('optional filtering rules', () => {
  it('filters by minimum level and excluded levels', () => {
    expect(engine.shouldEmit(record({ level: 'warn' }), [levelAtLeast('warn')])).toBe(true);
    expect(engine.shouldEmit(record({ level: 'debug' }), [levelAtLeast('warn')])).toBe(false);
    expect(engine.shouldEmit(record({ level: 'error' }), [excludeLevels(['error'])])).toBe(false);
  });

  it('samples deterministically at the boundaries', () => {
    expect(engine.shouldEmit(record(), [sample(0)])).toBe(false);
    expect(engine.shouldEmit(record(), [sample(1)])).toBe(true);
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.25);
    try {
      expect(engine.shouldEmit(record(), [sample(0.5)])).toBe(true);
      expect(engine.shouldEmit(record(), [sample(0.2)])).toBe(false);
    } finally {
      random.mockRestore();
    }
  });

  it('filters by channel with fail-closed include semantics', () => {
    const include = channelFilter({ include: ['audit'] });
    expect(engine.shouldEmit(record({ channel: 'audit' }), [include])).toBe(true);
    expect(engine.shouldEmit(record({ channel: 'main' }), [include])).toBe(false);
    expect(engine.shouldEmit(record(), [include])).toBe(false);
    expect(
      engine.shouldEmit(record({ channel: 'audit' }), [channelFilter({ exclude: ['audit'] })]),
    ).toBe(false);
  });

  it('reads context from the record and the supplied context', () => {
    const filter = byContext((context) => context.requestId === 'req-1');
    expect(engine.shouldEmit(record({ requestId: 'req-1' }), [filter])).toBe(true);
    expect(engine.shouldEmit(record(), [filter], { requestId: 'req-1' })).toBe(true);
    expect(engine.shouldEmit(record(), [filter])).toBe(false);
  });

  it('fails closed for broken composed filters', () => {
    const broken: () => boolean = () => {
      throw new Error('filter unavailable');
    };
    const composed = composeFilters(levelAtLeast('info'), broken);
    expect(engine.shouldEmit(record(), [composed])).toBe(false);
    expect(
      engine.shouldEmit(record(), [
        byContext(() => {
          throw new Error('bad');
        }),
      ]),
    ).toBe(false);
  });
});
