import {
  PrometheusExporter,
  PrometheusSerializer,
  type ExporterConfig,
} from '@opentelemetry/exporter-prometheus';

export interface PrometheusMetricReaderOptions extends ExporterConfig {
  readonly preventServerStart?: boolean;
}

export function createPrometheusMetricReader(
  options: PrometheusMetricReaderOptions = {},
): PrometheusExporter {
  return new PrometheusExporter({
    ...options,
    preventServerStart: options.preventServerStart ?? true,
  });
}

export async function getPrometheusMetricsText(exporter: PrometheusExporter): Promise<string> {
  const { resourceMetrics } = await exporter.collect();
  return new PrometheusSerializer().serialize(resourceMetrics);
}
