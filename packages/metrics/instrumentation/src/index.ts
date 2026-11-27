import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import type { ObserveMetrics } from '@aldok10/nestjs-observe-metrics';

export interface HttpRequestMetricInput {
  readonly method: string;
  readonly route: string;
  readonly statusCode: number;
  readonly durationMs: number;
}

export class HttpMetricsCollector {
  private readonly requestCount;
  private readonly requestDuration;
  private readonly errorCount;
  private readonly activeRequests;

  constructor(metrics: ObserveMetrics) {
    this.requestCount = metrics.counter('http.server.request.count', {
      description: 'Total HTTP requests',
    });
    this.requestDuration = metrics.histogram('http.server.request.duration', {
      description: 'HTTP request duration in ms',
      unit: 'ms',
    });
    this.errorCount = metrics.counter('http.server.error.count', {
      description: 'Total HTTP 5xx responses',
    });
    this.activeRequests = metrics.upDownCounter('http.server.active_requests', {
      description: 'Active in-flight HTTP requests',
    });
  }

  startRequest(method: string, route: string): void {
    this.activeRequests.add(1, { 'http.request.method': method, 'http.route': route });
  }

  finishRequest(input: HttpRequestMetricInput): void {
    const attrs = {
      'http.request.method': input.method,
      'http.route': input.route,
      'http.response.status_code': input.statusCode,
    };
    this.activeRequests.add(-1, {
      'http.request.method': input.method,
      'http.route': input.route,
    });
    this.requestCount.add(1, attrs);
    this.requestDuration.record(input.durationMs, attrs);
    if (input.statusCode >= 500) {
      this.errorCount.add(1, attrs);
    }
  }
}

interface EventLoopMonitorHandle {
  enable(): void;
  disable(): void;
  reset(): void;
  percentile(percentile: number): number;
}

export class RuntimeMetricsCollector {
  private readonly metrics: ObserveMetrics;
  private eventLoopMonitor: EventLoopMonitorHandle | undefined;
  private lastCpu = process.cpuUsage();
  private lastElu = performance.eventLoopUtilization();
  private started = false;

  constructor(metrics: ObserveMetrics) {
    this.metrics = metrics;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    const monitor = monitorEventLoopDelay({ resolution: 20 });
    monitor.enable();
    this.eventLoopMonitor = monitor;

    const memoryGauge = this.metrics.observableGauge('process.runtime.nodejs.memory.rss', {
      unit: 'By',
      description: 'Resident set size in bytes',
    });
    memoryGauge.addCallback((result) => {
      result.observe(process.memoryUsage().rss);
    });

    const heapGauge = this.metrics.observableGauge('process.runtime.nodejs.memory.heap_used', {
      unit: 'By',
      description: 'V8 heap used in bytes',
    });
    heapGauge.addCallback((result) => {
      result.observe(process.memoryUsage().heapUsed);
    });

    const cpuGauge = this.metrics.observableGauge('process.runtime.nodejs.cpu.usage_us', {
      unit: 'us',
      description: 'CPU user+system microseconds delta',
    });
    cpuGauge.addCallback((result) => {
      const delta = process.cpuUsage(this.lastCpu);
      this.lastCpu = process.cpuUsage();
      result.observe(delta.user + delta.system);
    });

    const eluGauge = this.metrics.observableGauge('process.runtime.nodejs.eventloop.utilization', {
      description: 'Event loop utilization ratio (0..1)',
    });
    eluGauge.addCallback((result) => {
      const next = performance.eventLoopUtilization(this.lastElu);
      this.lastElu = performance.eventLoopUtilization();
      result.observe(next.utilization);
    });

    const delayGauge = this.metrics.observableGauge(
      'process.runtime.nodejs.eventloop.delay_p99_ms',
      {
        unit: 'ms',
        description: 'Event loop delay p99 in ms',
      },
    );
    delayGauge.addCallback((result) => {
      if (this.eventLoopMonitor !== undefined) {
        result.observe(this.eventLoopMonitor.percentile(99) / 1_000_000);
        this.eventLoopMonitor.reset();
      }
    });
  }

  stop(): void {
    if (!this.started) return;
    this.eventLoopMonitor?.disable();
    this.eventLoopMonitor = undefined;
    this.started = false;
  }
}

export class DataMetricsCollector {
  private readonly dbDuration;
  private readonly redisDuration;
  private readonly queueDepth;
  private readonly queueDuration;
  private readonly workerJobs;

  constructor(metrics: ObserveMetrics) {
    this.dbDuration = metrics.histogram('db.client.operation.duration', { unit: 'ms' });
    this.redisDuration = metrics.histogram('redis.client.operation.duration', { unit: 'ms' });
    this.queueDepth = metrics.upDownCounter('queue.depth');
    this.queueDuration = metrics.histogram('queue.processing.duration', { unit: 'ms' });
    this.workerJobs = metrics.counter('worker.job.count');
  }

  recordDbOperation(system: string, operation: string, durationMs: number, ok = true): void {
    this.dbDuration.record(durationMs, {
      'db.system.name': system,
      'db.operation.name': operation,
      status: ok ? 'ok' : 'error',
    });
  }

  recordRedisOperation(command: string, durationMs: number, ok = true): void {
    this.redisDuration.record(durationMs, {
      'db.operation.name': command,
      status: ok ? 'ok' : 'error',
    });
  }

  adjustQueueDepth(queueName: string, delta: number): void {
    this.queueDepth.add(delta, { 'messaging.destination.name': queueName });
  }

  recordQueueProcessing(queueName: string, durationMs: number, ok = true): void {
    this.queueDuration.record(durationMs, {
      'messaging.destination.name': queueName,
      status: ok ? 'ok' : 'error',
    });
  }

  recordWorkerJob(jobName: string, ok = true): void {
    this.workerJobs.add(1, {
      'worker.job.name': jobName,
      status: ok ? 'ok' : 'error',
    });
  }
}
