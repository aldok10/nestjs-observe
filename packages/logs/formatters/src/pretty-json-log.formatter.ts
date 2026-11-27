import type {
  FormatterOptions,
  LogFormatter,
  LogRecord,
} from '@aldok10/nestjs-observe-logger-core/contracts';
import { LogRecordNormalizer } from '@aldok10/nestjs-observe-logger-core/formatters';

export class PrettyJsonLogFormatter implements LogFormatter {
  constructor(
    private readonly options: FormatterOptions = {},
    private readonly normalizer: LogRecordNormalizer = new LogRecordNormalizer(),
  ) {}

  format(record: LogRecord): string {
    return JSON.stringify(this.normalizer.normalize(record, this.options), null, 2);
  }
}

export function createPrettyJsonFormatter(options: FormatterOptions = {}): LogFormatter {
  return new PrettyJsonLogFormatter(options);
}

export const prettyJsonFormatter: LogFormatter = new PrettyJsonLogFormatter();
