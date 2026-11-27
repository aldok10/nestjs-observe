import type { FormatterOptions, FormatterType, LogFormatter } from '../contracts/index.js';
import { InvalidLoggerConfigurationException } from '../exceptions/index.js';
import { defaultFormatter } from './default.formatter.js';

export type FormatterFactory = (options: FormatterOptions) => LogFormatter;

const factories = new Map<string, FormatterFactory>();

export class FormatterRegistry {
  register(type: string, factory: FormatterFactory): void {
    factories.set(type, factory);
  }

  has(type: string): boolean {
    return factories.has(type);
  }

  get(type: string): FormatterFactory | undefined {
    return factories.get(type);
  }
}

export const formatterRegistry = new FormatterRegistry();

export function registerFormatter(type: string, factory: FormatterFactory): void {
  formatterRegistry.register(type, factory);
}

export function resolveFormatter(
  type: FormatterType | LogFormatter | undefined,
  options: FormatterOptions = {},
): LogFormatter {
  if (type === undefined) return defaultFormatter;
  if (typeof type !== 'string') return type;
  const factory = formatterRegistry.get(type);
  if (factory === undefined) {
    throw new InvalidLoggerConfigurationException(
      `Unknown formatter type: ${type}. Pass a LogFormatter or register one with registerFormatter('${type}', factory) from a @aldok10/nestjs-observe-logger-format-* package.`,
    );
  }
  return factory(options);
}
