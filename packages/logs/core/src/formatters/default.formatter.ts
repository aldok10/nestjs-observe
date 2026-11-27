import type { LogFormatter, LogRecord } from '../contracts/index.js';
import { normalizedFields } from './log-record.normalizer.js';

// Minimal fallback so core can format a record without any format package installed.
export class DefaultFormatter implements LogFormatter {
  format(record: LogRecord): string {
    return JSON.stringify(normalizedFields(record));
  }
}

export const defaultFormatter: LogFormatter = new DefaultFormatter();
