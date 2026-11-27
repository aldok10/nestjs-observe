import { registerFormatter } from '@aldok10/nestjs-observe-logger-core/formatters';
import { createJsonFormatter } from './json-log.formatter.js';

export { JsonLogFormatter, createJsonFormatter, jsonFormatter } from './json-log.formatter.js';

export function registerJsonFormatter(): void {
  registerFormatter('json', (options) => createJsonFormatter(options));
}

registerJsonFormatter();
