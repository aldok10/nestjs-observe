import { describe, expect, it } from 'vitest';
import type { RedactionOptions } from '../contracts/index.js';
import { RedactionEngine, sanitize } from './redaction-engine.js';

interface StringLeafCase {
  readonly label: string;
  readonly input: string;
  readonly options?: RedactionOptions;
  readonly expected: string;
}

interface LimitCase {
  readonly label: string;
  readonly input: unknown;
  readonly options: RedactionOptions;
  readonly assert: (output: unknown) => void;
}

interface PolicyCase {
  readonly label: string;
  readonly input: Record<string, unknown>;
  readonly options: RedactionOptions;
  readonly expected: Record<string, unknown>;
}

const STRING_LEAF_CASES: readonly StringLeafCase[] = [
  { label: 'equals key=secret', input: 'password=hunter2', expected: '[REDACTED]' },
  { label: 'JSON-like apiKey string', input: '"apiKey": "secret-key"', expected: '[REDACTED]' },
  {
    label: 'Authorization header string',
    input: 'Authorization: Bearer abc',
    expected: '[REDACTED]',
  },
  {
    label: 'denylist token inside string',
    input: 'userId: u1',
    options: { denylist: ['userId'] },
    expected: '[REDACTED]',
  },
  {
    label: 'harmless prose with password',
    input: 'password was changed',
    expected: 'password was changed',
  },
  {
    label: 'harmless prose with secret',
    input: 'the secret is safe',
    expected: 'the secret is safe',
  },
  {
    label: 'custom matcher on string leaf',
    input: 'hide me',
    options: { matchers: [(_key, value) => value === 'hide me'], replacement: '***' },
    expected: '***',
  },
  {
    label: 'custom RegExp pattern',
    input: 'panic at dawn',
    options: { patterns: [/panic/i] },
    expected: '[REDACTED]',
  },
];

const LIMIT_CASES: readonly LimitCase[] = [
  {
    label: 'caps maxKeys on wide object',
    input: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`key${i}`, i])),
    options: { maxKeys: 5 },
    assert: (output) => {
      expect(Object.keys(output as object)).toHaveLength(5);
    },
  },
  {
    label: 'caps maxDepth on nested object',
    input: { a: { b: { c: 'deep' } } },
    options: { maxDepth: 2 },
    assert: (output) => {
      expect(output).toEqual({ a: { b: '[Max depth]' } });
    },
  },
  {
    label: 'truncates long string fields',
    input: { note: 'x'.repeat(100) },
    options: { maxStringLength: 20 },
    assert: (output) => {
      const note = (output as { note: string }).note;
      expect(note).toHaveLength(20);
      expect(note).toContain('[truncated]');
    },
  },
  {
    label: 'truncates long standalone string',
    input: 'x'.repeat(100),
    options: { maxStringLength: 20 },
    assert: (output) => {
      expect(output).toHaveLength(20);
    },
  },
];

const CUSTOM_POLICY_CASES: readonly PolicyCase[] = [
  {
    label: 'allowlist permits explicitly allowed sensitive key',
    input: { password: 'visible' },
    options: { allowlist: ['PASSWORD'] },
    expected: { password: 'visible' },
  },
  {
    label: 'denylist masks non-default key',
    input: { userId: 'u1', token: 't1' },
    options: { denylist: ['userId'] },
    expected: { userId: '[REDACTED]', token: 't1' },
  },
  {
    label: 'custom matcher and replacement string',
    input: { note: 'hide', keep: 'yes' },
    options: { matchers: [(key) => key === 'note'], replacement: '***' },
    expected: { note: '***', keep: 'yes' },
  },
];

describe('RedactionEngine', () => {
  describe('sanitize', () => {
    it('redacts nested sensitive keys and sensitive keys inside arrays', () => {
      const input = {
        level: 'info',
        nested: { password: 'hunter2', Authorization: 'Bearer abc', safe: 'keep' },
        items: [{ apiKey: 'secret-key', name: 'first' }],
      };

      expect(sanitize(input)).toEqual({
        level: 'info',
        nested: { password: '[REDACTED]', Authorization: '[REDACTED]', safe: 'keep' },
        items: [{ apiKey: '[REDACTED]', name: 'first' }],
      });
    });

    it('does not leak original values through cycles or shared references', () => {
      const input: Record<string, unknown> = { name: 'root' };
      input['self'] = input;
      input['children'] = [input, { privateKey: 'pk', note: 'ok' }];

      const output = new RedactionEngine().sanitize(input);
      expect(output).toEqual({
        name: 'root',
        self: '[Circular]',
        children: ['[Circular]', { privateKey: '[REDACTED]', note: 'ok' }],
      });
      expect(JSON.stringify(output)).not.toContain('"pk"');
    });

    it.each(LIMIT_CASES)('$label', ({ input, options, assert }) => {
      assert(sanitize(input, options));
    });

    it.each(CUSTOM_POLICY_CASES)('$label', ({ input, options, expected }) => {
      expect(sanitize(input, options)).toEqual(expected);
    });

    it.each(STRING_LEAF_CASES)('string leaf: $label', ({ input, options, expected }) => {
      expect(sanitize(input, options)).toBe(expected);
    });

    it('reduces Buffer input to a length-only placeholder', () => {
      expect(sanitize({ payload: Buffer.from('password=hunter2') })).toEqual({
        payload: '[Buffer 16 bytes]',
      });
    });

    it('does not throw on hostile metadata', () => {
      const hostile = new Proxy(
        {},
        {
          ownKeys() {
            throw new Error('broken');
          },
        },
      );
      expect(() => sanitize(hostile)).not.toThrow();
    });

    it('redacts secrets inside messages and serialized errors', () => {
      const error = new Error('password=hunter2');
      error.stack = 'Error: password=hunter2\n    at test';

      expect(sanitize({ message: 'password=hunter2', error })).toEqual({
        message: '[REDACTED]',
        error: { name: 'Error', message: '[REDACTED]', stack: '[REDACTED]' },
      });
    });
  });
});
