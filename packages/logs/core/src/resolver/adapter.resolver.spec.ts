import { describe, expect, it } from 'vitest';
import type { LoggerAdapter } from '../contracts/index.js';
import {
  AdapterNotFoundException,
  DuplicateAdapterException,
  InvalidLoggerConfigurationException,
} from '../exceptions/index.js';
import { AdapterResolver } from './index.js';

function createStubAdapter(name: string): LoggerAdapter {
  return {
    name,
    create() {
      return { log() {}, warn() {}, error() {}, debug() {} };
    },
  };
}

const RESOLUTION_CASES: ReadonlyArray<{
  readonly registered: readonly string[];
  readonly lookup: string;
  readonly expectedHas: boolean;
}> = [
  { registered: ['nestjs'], lookup: 'nestjs', expectedHas: true },
  { registered: ['nestjs'], lookup: 'pino', expectedHas: false },
  { registered: ['nestjs', 'pino', 'winston'], lookup: 'winston', expectedHas: true },
];

describe('AdapterResolver', () => {
  describe('resolve & has', () => {
    it.each(RESOLUTION_CASES)(
      'lookup("$lookup") in [$registered] -> has=$expectedHas',
      ({ registered, lookup, expectedHas }) => {
        const resolver = new AdapterResolver(registered.map(createStubAdapter));
        expect(resolver.has(lookup)).toBe(expectedHas);
        if (expectedHas) {
          expect(resolver.resolve(lookup).name).toBe(lookup);
        } else {
          expect(() => resolver.resolve(lookup)).toThrow(AdapterNotFoundException);
          expect(() => resolver.resolve(lookup)).toThrow(`Unknown logger adapter: ${lookup}`);
        }
      },
    );
  });

  describe('register', () => {
    it('rejects duplicate names in the constructor and via register', () => {
      expect(
        () => new AdapterResolver([createStubAdapter('pino'), createStubAdapter('pino')]),
      ).toThrow(DuplicateAdapterException);
      const resolver = new AdapterResolver();
      expect(resolver.register(createStubAdapter('pino'))).toBe(resolver);
      expect(() => resolver.register(createStubAdapter('pino'))).toThrow(
        /Duplicate logger adapter: pino/,
      );
    });

    it('rejects empty adapter names', () => {
      const resolver = new AdapterResolver();
      expect(() => resolver.register(createStubAdapter(''))).toThrow(
        InvalidLoggerConfigurationException,
      );
    });
  });
});
