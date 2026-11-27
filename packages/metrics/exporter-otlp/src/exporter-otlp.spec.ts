import { describe, expect, it } from 'vitest';
import { createOtlpMetricExporter, createOtlpMetricReader } from './index.js';

describe('OTLP metric exporter', () => {
  it('creates an OTLPMetricExporter and PeriodicExportingMetricReader', async () => {
    const exporter = createOtlpMetricExporter({ url: 'http://localhost:4318/v1/metrics' });
    const reader = createOtlpMetricReader({
      url: 'http://localhost:4318/v1/metrics',
      exportIntervalMillis: 60_000,
    });
    expect(exporter).toBeDefined();
    expect(reader).toBeDefined();
    await reader.shutdown();
    await exporter.shutdown();
  });
});
