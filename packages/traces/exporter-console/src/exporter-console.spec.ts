import { describe, expect, it } from 'vitest';
import { createConsoleSpanProcessor, createConsoleTraceExporter } from './index.js';

describe('Console trace exporter', () => {
  it('creates a ConsoleSpanExporter and SimpleSpanProcessor', async () => {
    const exporter = createConsoleTraceExporter();
    const processor = createConsoleSpanProcessor();
    expect(exporter).toBeDefined();
    expect(processor).toBeDefined();
    await processor.shutdown();
    await exporter.shutdown();
  });
});
