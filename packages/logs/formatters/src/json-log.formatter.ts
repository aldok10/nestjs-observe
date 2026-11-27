import type {
  FormatterOptions,
  LogFormatter,
  LogRecord,
} from '@aldok10/nestjs-observe-logger-core/contracts';
import { LogRecordNormalizer } from '@aldok10/nestjs-observe-logger-core/formatters';

export class JsonLogFormatter implements LogFormatter {
  constructor(
    private readonly options: FormatterOptions = {},
    private readonly normalizer: LogRecordNormalizer = new LogRecordNormalizer(),
  ) {}

  format(record: LogRecord): string {
    return JSON.stringify(this.normalizer.normalize(record, this.options));
  }
}

export function createJsonFormatter(options: FormatterOptions = {}): LogFormatter {
  return new JsonLogFormatter(options);
}

export const jsonFormatter: LogFormatter = new JsonLogFormatter();
