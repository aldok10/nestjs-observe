import { describe, expect, it } from 'vitest';
import { FilterEngine } from './filter-engine.js';
import type { LogRecord } from '../contracts/index.js';

const record: LogRecord = {
  schemaVersion: 1,
  timestamp: Date.now(),
  level: 'info',
  message: 'hello',
};

describe('FilterEngine', () => {
  it('accepts when all filters pass', () => {
    const engine = new FilterEngine();
    expect(engine.shouldEmit(record, [() => true, () => true])).toBe(true);
  });

  it('drops when any filter rejects', () => {
    const engine = new FilterEngine();
    expect(engine.shouldEmit(record, [() => true, () => false])).toBe(false);
  });

  it('fails closed when a filter throws', () => {
    const engine = new FilterEngine();
    expect(
      engine.shouldEmit(record, [
        () => {
          throw new Error('boom');
        },
      ]),
    ).toBe(false);
  });
});
