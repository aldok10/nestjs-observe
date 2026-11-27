import {
  OTLPMetricExporter,
  type OTLPMetricExporterOptions,
} from '@opentelemetry/exporter-metrics-otlp-http';
import {
  PeriodicExportingMetricReader,
  type PeriodicExportingMetricReaderOptions,
} from '@opentelemetry/sdk-metrics';

export interface OtlpMetricReaderOptions extends OTLPMetricExporterOptions {
  readonly exportIntervalMillis?: number;
  readonly exportTimeoutMillis?: number;
}

export function createOtlpMetricExporter(
  options: OTLPMetricExporterOptions = {},
): OTLPMetricExporter {
  return new OTLPMetricExporter(options);
}

export function createOtlpMetricReader(
  options: OtlpMetricReaderOptions = {},
): PeriodicExportingMetricReader {
  const exporter = createOtlpMetricExporter(options);
  const readerOptions: PeriodicExportingMetricReaderOptions = {
    exporter,
    ...(options.exportIntervalMillis !== undefined
      ? { exportIntervalMillis: options.exportIntervalMillis }
      : {}),
    ...(options.exportTimeoutMillis !== undefined
      ? { exportTimeoutMillis: options.exportTimeoutMillis }
      : {}),
  };
  return new PeriodicExportingMetricReader(readerOptions);
}
