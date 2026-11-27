import { registerFormatter } from '@aldok10/nestjs-observe-logger-core/formatters';
import { createPrettyJsonFormatter } from './pretty-json-log.formatter.js';

export {
  PrettyJsonLogFormatter,
  createPrettyJsonFormatter,
  prettyJsonFormatter,
} from './pretty-json-log.formatter.js';

export function registerPrettyJsonFormatter(): void {
  registerFormatter('prettyJson', (options) => createPrettyJsonFormatter(options));
}

registerPrettyJsonFormatter();
