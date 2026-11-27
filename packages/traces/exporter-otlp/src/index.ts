import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchSpanProcessor, type BatchSpanProcessorOptions } from '@opentelemetry/sdk-trace';

export interface OtlpTraceExporterOptions {
  readonly url?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMillis?: number;
  readonly concurrencyLimit?: number;
}

export function createOtlpTraceExporter(options: OtlpTraceExporterOptions = {}): OTLPTraceExporter {
  return new OTLPTraceExporter({
    ...(options.url !== undefined ? { url: options.url } : {}),
    ...(options.headers !== undefined ? { headers: { ...options.headers } } : {}),
    ...(options.timeoutMillis !== undefined ? { timeoutMillis: options.timeoutMillis } : {}),
    ...(options.concurrencyLimit !== undefined
      ? { concurrencyLimit: options.concurrencyLimit }
      : {}),
  });
}

export function createOtlpTraceSpanProcessor(
  options: OtlpTraceExporterOptions & {
    readonly batch?: Omit<BatchSpanProcessorOptions, 'exporter'>;
  } = {},
): BatchSpanProcessor {
  const exporter = createOtlpTraceExporter(options);
  return new BatchSpanProcessor({ ...options.batch, exporter });
}
