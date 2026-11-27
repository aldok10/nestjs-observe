import type { DiagnosticsSink, ResourceMetadata } from '@aldok10/nestjs-observe-core';
import type { Attributes, Link, SpanKind } from '@opentelemetry/api';
import type { Sampler, SpanProcessor } from '@opentelemetry/sdk-trace';

export type TracingSamplingConfig =
  | { readonly strategy: 'always_on' }
  | { readonly strategy: 'always_off' }
  | { readonly strategy: 'ratio'; readonly ratio: number; readonly parentBased?: boolean };

export interface TracingOptions {
  readonly resource?: ResourceMetadata;
  readonly sampler?: Sampler | TracingSamplingConfig;
  readonly spanProcessors?: readonly SpanProcessor[];
  readonly registerGlobal?: boolean;
  readonly shutdownTimeoutMs?: number;
  readonly diagnostics?: DiagnosticsSink;
  readonly global?: boolean;
}

export interface SpanOptions {
  readonly kind?: SpanKind;
  readonly attributes?: Attributes;
  readonly links?: readonly Link[];
}

export interface TraceContextSnapshot {
  readonly traceId?: string;
  readonly spanId?: string;
  readonly traceFlags?: number;
}

export interface TraceDecoratorOptions {
  readonly name?: string;
  readonly kind?: SpanKind;
  readonly attributes?: Attributes;
  readonly recordException?: boolean;
}
