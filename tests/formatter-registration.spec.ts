import { describe, expect, it } from 'vitest';
import type { LogRecord } from '@aldok10/nestjs-observe-logger-core/contracts';
import {
  registerFormatter,
  resolveFormatter,
} from '@aldok10/nestjs-observe-logger-core/formatters';
import { registerJsonFormatter } from '../packages/logs/formatters/src/json.js';
import { registerPrettyJsonFormatter } from '../packages/logs/formatters/src/pretty.js';
import { registerTextFormatter } from '../packages/logs/formatters/src/text.js';

const record: LogRecord = {
  schemaVersion: 1,
  timestamp: 1_700_000_000_000,
  level: 'info',
  message: 'explicit',
};

const registrations = [
  ['json', registerJsonFormatter],
  ['prettyJson', registerPrettyJsonFormatter],
  ['text', registerTextFormatter],
] as const;

describe('explicit formatter registration', () => {
  it('works without relying on import side effects', () => {
    for (const [type, register] of registrations) {
      registerFormatter(type, () => {
        throw new Error('not registered');
      });
      expect(() => resolveFormatter(type)).toThrow(/not registered/);
      register();
      expect(() => resolveFormatter(type).format(record)).not.toThrow();
    }
  });
});
