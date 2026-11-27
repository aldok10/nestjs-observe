import { LogPipeline, UniversalLoggerImpl } from '@aldok10/nestjs-observe-logger-core';
import { ConsoleTransport } from '@aldok10/nestjs-observe-logger-transports/console';
import type { LogFormatter, LogRecord } from '@aldok10/nestjs-observe-logger-core/contracts';

// No built-in format package installed: a custom formatter is enough.
const formatter: LogFormatter = {
  format: (record: LogRecord) =>
    `${record.timestamp} ${record.level.toUpperCase()} ${record.message}`,
};

const pipeline = new LogPipeline({
  transports: [new ConsoleTransport({ formatter })],
});
const logger = new UniversalLoggerImpl({ pipeline });
logger.info('service ready', { requestId: 'req-1' });
await pipeline.close();
