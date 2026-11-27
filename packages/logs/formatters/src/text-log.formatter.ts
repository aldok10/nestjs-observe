import type {
  FormatterOptions,
  LogFormatter,
  LogRecord,
} from '@aldok10/nestjs-observe-logger-core/contracts';
import { LogRecordNormalizer } from '@aldok10/nestjs-observe-logger-core/formatters';

function sanitizeLogLine(value: string): string {
  // Explicit control-char escaping is required for log injection defense.
  // oxlint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, (char) => {
    switch (char) {
      case '\n':
        return '\\n';
      case '\r':
        return '\\r';
      case '\t':
        return '\\t';
      default:
        return `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`;
    }
  });
}

export class TextLogFormatter implements LogFormatter {
  constructor(
    private readonly options: FormatterOptions = {},
    private readonly normalizer: LogRecordNormalizer = new LogRecordNormalizer(),
  ) {}

  format(record: LogRecord): string {
    const fields = this.normalizer.normalize(record, {
      ...this.options,
      timestamp: this.options.timestamp ?? 'iso',
    });
    const rawTimestamp = fields['timestamp'];
    const timestamp =
      typeof rawTimestamp === 'string'
        ? rawTimestamp
        : typeof rawTimestamp === 'number'
          ? String(rawTimestamp)
          : String(record.timestamp);
    const rawLevel = fields['level'];
    const severity = sanitizeLogLine(
      (typeof rawLevel === 'string' ? rawLevel : record.level).toUpperCase(),
    );
    const channel = this.normalizer.readStringField(fields, 'channel');
    const context = this.normalizer.readStringField(fields, 'context');
    const message = this.normalizer.readStringField(fields, 'message') ?? '';
    let line = `${sanitizeLogLine(timestamp)} ${severity}${channel === undefined ? '' : ` [${sanitizeLogLine(channel)}]`}${context === undefined ? '' : ` [${sanitizeLogLine(context)}]`} ${sanitizeLogLine(message)}`;

    const requestId = this.normalizer.readStringField(fields, 'requestId');
    if (requestId !== undefined) line += ` requestId=${sanitizeLogLine(requestId)}`;
    const traceId = this.normalizer.readStringField(fields, 'traceId');
    if (traceId !== undefined) line += ` traceId=${sanitizeLogLine(traceId)}`;

    if (this.options.includeMetadata !== false) {
      const metadata = fields['metadata'];
      if (typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)) {
        if (Object.keys(metadata).length > 0)
          line += ` metadata=${sanitizeLogLine(JSON.stringify(metadata))}`;
      }
    }

    return line;
  }
}

export function createTextFormatter(options: FormatterOptions = {}): LogFormatter {
  return new TextLogFormatter(options);
}

export const textFormatter: LogFormatter = new TextLogFormatter();
