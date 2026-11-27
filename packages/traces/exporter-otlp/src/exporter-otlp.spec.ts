import { describe, expect, it } from 'vitest';
import { createOtlpTraceExporter, createOtlpTraceSpanProcessor } from './index.js';

describe('OTLP trace exporter', () => {
  it('creates an OTLPTraceExporter and BatchSpanProcessor', async () => {
    const exporter = createOtlpTraceExporter({ url: 'http://localhost:4318/v1/traces' });
    expect(exporter).toBeDefined();
    const processor = createOtlpTraceSpanProcessor({ url: 'http://localhost:4318/v1/traces' });
    expect(processor).toBeDefined();
    await processor.shutdown();
    await exporter.shutdown();
  });
});
