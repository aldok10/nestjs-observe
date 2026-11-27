import type { LogContext, LogFilter, LogRecord } from '../contracts/index.js';

export class FilterEngine {
  shouldEmit(record: LogRecord, filters: readonly LogFilter[], context: LogContext = {}): boolean {
    for (const filter of filters) {
      try {
        if (!filter(record, context)) return false;
      } catch {
        // Fail closed: a broken filter must not leak records.
        return false;
      }
    }
    return true;
  }
}
