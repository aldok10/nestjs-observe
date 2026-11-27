export { CardinalityGuard } from './cardinality-guard.js';
export { MetricCounter, MetricHistogram } from './metric.decorators.js';
export type {
  CardinalityGuardOptions,
  MetricDecoratorOptions,
  MetricsOptions,
} from './metrics.contracts.js';
export {
  METRICS_OPTIONS,
  METRICS_RUNTIME,
  MetricsLifecycleService,
  MetricsModule,
  OBSERVE_METRICS,
  type MetricsAsyncOptions,
  type MetricsOptionsFactory,
} from './metrics.module.js';
export { MetricsRuntime, bootstrapMetrics } from './metrics.runtime.js';
export {
  ObserveMetrics,
  type CounterHandle,
  type GaugeHandle,
  type HistogramHandle,
} from './observe-metrics.service.js';
