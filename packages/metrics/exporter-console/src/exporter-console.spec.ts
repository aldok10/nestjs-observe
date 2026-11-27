import { describe, expect, it } from 'vitest';
import { createConsoleMetricExporter, createConsoleMetricReader } from './index.js';

describe('Console metric exporter', () => {
  it('creates a ConsoleMetricExporter and PeriodicExportingMetricReader', async () => {
    const exporter = createConsoleMetricExporter();
    const reader = createConsoleMetricReader({ exportIntervalMillis: 60_000 });
    expect(exporter).toBeDefined();
    expect(reader).toBeDefined();
    await reader.shutdown();
    await exporter.shutdown();
  });
});
