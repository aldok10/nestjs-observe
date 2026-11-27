import type { DiagnosticsSink, ResourceMetadata } from '@aldok10/nestjs-observe-core';
import type { IMetricReader, ViewOptions } from '@opentelemetry/sdk-metrics';

export interface CardinalityGuardOptions {
  readonly forbiddenKeys?: readonly string[];
  readonly maxDistinctValuesPerKey?: number;
  readonly overflowValue?: string;
}

export interface MetricsOptions {
  readonly resource?: ResourceMetadata;
  readonly readers?: readonly IMetricReader[];
  readonly views?: readonly ViewOptions[];
  readonly cardinality?: CardinalityGuardOptions;
  readonly registerGlobal?: boolean;
  readonly shutdownTimeoutMs?: number;
  readonly diagnostics?: DiagnosticsSink;
  readonly global?: boolean;
}

export interface MetricDecoratorOptions {
  readonly name?: string;
  readonly description?: string;
  readonly unit?: string;
}
