import {
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace';

export function createConsoleTraceExporter(): ConsoleSpanExporter {
  return new ConsoleSpanExporter();
}

export function createConsoleSpanProcessor(): SpanProcessor {
  return new SimpleSpanProcessor({ exporter: createConsoleTraceExporter() });
}
