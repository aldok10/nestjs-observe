import { registerFormatter } from '@aldok10/nestjs-observe-logger-core/formatters';
import { createTextFormatter } from './text-log.formatter.js';

export { TextLogFormatter, createTextFormatter, textFormatter } from './text-log.formatter.js';

export function registerTextFormatter(): void {
  registerFormatter('text', (options) => createTextFormatter(options));
}

registerTextFormatter();
