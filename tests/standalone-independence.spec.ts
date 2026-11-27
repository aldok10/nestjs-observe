import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ObserverRuntime } from '@aldok10/nestjs-observe';
import { CaptureTransport } from '@aldok10/nestjs-observe-logger-testing';
import { createLoggerManager } from '@aldok10/nestjs-observe-logger-core';
import { MetricsRuntime, ObserveMetrics } from '@aldok10/nestjs-observe-metrics';
import { TracingRuntime, ObserveTracer } from '@aldok10/nestjs-observe-tracing';
import { MetricReader } from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace';

class NoopMetricReader extends MetricReader {
  protected async onForceFlush(): Promise<void> {}
  protected async onShutdown(): Promise<void> {}
}

function readPkg(relPath: string): {
  readonly dependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly peerDependenciesMeta?: Record<string, { optional?: boolean }>;
} {
  return JSON.parse(readFileSync(join(process.cwd(), relPath, 'package.json'), 'utf8'));
}

describe('Standalone domain independence & Observer composition', () => {
  it('Logger manifests have zero dependencies on Tracing, Metrics, or Observer', () => {
    const loggerCore = readPkg('packages/logs/core');
    const loggerMain = readPkg('packages/logs/logger');
    for (const pkg of [loggerCore, loggerMain]) {
      const deps = [
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.peerDependencies ?? {}),
      ];
      expect(
        deps.some(
          (d) => d.includes('tracing') || d.includes('metrics') || d === '@aldok10/nestjs-observe',
        ),
      ).toBe(false);
    }
  });

  it('Tracing manifests have zero dependencies on Logger, Metrics, or Observer', () => {
    const tracing = readPkg('packages/traces/tracing');
    const deps = [
      ...Object.keys(tracing.dependencies ?? {}),
      ...Object.keys(tracing.peerDependencies ?? {}),
    ];
    expect(
      deps.some(
        (d) => d.includes('logger') || d.includes('metrics') || d === '@aldok10/nestjs-observe',
      ),
    ).toBe(false);
  });

  it('Metrics manifests have zero dependencies on Logger, Tracing, or Observer', () => {
    const metrics = readPkg('packages/metrics/metrics');
    const deps = [
      ...Object.keys(metrics.dependencies ?? {}),
      ...Object.keys(metrics.peerDependencies ?? {}),
    ];
    expect(
      deps.some(
        (d) => d.includes('logger') || d.includes('tracing') || d === '@aldok10/nestjs-observe',
      ),
    ).toBe(false);
  });

  it('Logger works standalone without Tracing, Metrics, or Observer', async () => {
    const capture = new CaptureTransport();
    const manager = createLoggerManager({
      channels: [{ name: 'app', transports: [capture] }],
      defaultChannel: 'app',
    });
    manager.getLogger().info('standalone logger');
    expect(capture.records.map((r) => r.message)).toEqual(['standalone logger']);
    await manager.shutdown();
  });

  it('Tracing works standalone without Logger, Metrics, or Observer', async () => {
    const exporter = new InMemorySpanExporter();
    const runtime = new TracingRuntime({
      spanProcessors: [new SimpleSpanProcessor({ exporter })],
    });
    runtime.initialize();
    const tracer = new ObserveTracer(runtime);
    await tracer.withSpan('standalone.span', async () => 'ok');
    expect(exporter.getFinishedSpans().map((s) => s.name)).toContain('standalone.span');
    await runtime.shutdown();
  });

  it('Metrics works standalone without Logger, Tracing, or Observer', async () => {
    const reader = new NoopMetricReader();
    const runtime = new MetricsRuntime({ readers: [reader] });
    runtime.initialize();
    const metrics = new ObserveMetrics(runtime);
    metrics.counter('standalone.counter').add(2);
    const { resourceMetrics } = await reader.collect();
    const names = resourceMetrics.scopeMetrics.flatMap((s) =>
      s.metrics.map((m) => m.descriptor.name),
    );
    expect(names).toContain('standalone.counter');
    await runtime.shutdown();
  });

  it('Observer does not initialize disabled domains', async () => {
    const runtime = new ObserverRuntime({
      logger: false,
      tracing: false,
      metrics: false,
    });
    await runtime.initialize();
    expect(runtime.logger).toBeUndefined();
    expect(runtime.tracer).toBeUndefined();
    expect(runtime.metrics).toBeUndefined();
    expect((await runtime.health()).components).toEqual([]);
    await runtime.shutdown();
  });
});
