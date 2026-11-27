import { ConsoleMetricExporter, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';

export interface ConsoleMetricReaderOptions {
  readonly exportIntervalMillis?: number;
  readonly exportTimeoutMillis?: number;
}

export function createConsoleMetricExporter(): ConsoleMetricExporter {
  return new ConsoleMetricExporter();
}

export function createConsoleMetricReader(
  options: ConsoleMetricReaderOptions = {},
): PeriodicExportingMetricReader {
  return new PeriodicExportingMetricReader({
    exporter: createConsoleMetricExporter(),
    ...(options.exportIntervalMillis !== undefined
      ? { exportIntervalMillis: options.exportIntervalMillis }
      : {}),
    ...(options.exportTimeoutMillis !== undefined
      ? { exportTimeoutMillis: options.exportTimeoutMillis }
      : {}),
  });
}
