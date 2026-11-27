import { Injectable } from '@nestjs/common';
import type {
  Attributes,
  Counter,
  Gauge,
  Histogram,
  Meter,
  MetricOptions,
  ObservableCounter,
  ObservableGauge,
  ObservableUpDownCounter,
  UpDownCounter,
} from '@opentelemetry/api';
import { CardinalityGuard } from './cardinality-guard.js';
import type { CardinalityGuardOptions } from './metrics.contracts.js';
import type { MetricsRuntime } from './metrics.runtime.js';

export interface CounterHandle {
  add(value: number, attributes?: Attributes): void;
}

export interface HistogramHandle {
  record(value: number, attributes?: Attributes): void;
}

export interface GaugeHandle {
  record(value: number, attributes?: Attributes): void;
}

export class ObserveMetrics {
  private readonly guard: CardinalityGuard;
  private readonly counters = new Map<string, Counter>();
  private readonly upDownCounters = new Map<string, UpDownCounter>();
  private readonly histograms = new Map<string, Histogram>();
  private readonly gauges = new Map<string, Gauge>();
  private readonly observableCounters = new Map<string, ObservableCounter>();
  private readonly observableGauges = new Map<string, ObservableGauge>();
  private readonly observableUpDownCounters = new Map<string, ObservableUpDownCounter>();

  constructor(
    private readonly runtime: MetricsRuntime,
    cardinalityOptions?: CardinalityGuardOptions,
  ) {
    this.guard = new CardinalityGuard(cardinalityOptions);
  }

  getMeter(name?: string, version?: string): Meter {
    return this.runtime.getMeter(name, version);
  }

  counter(name: string, options?: MetricOptions): CounterHandle {
    let inst = this.counters.get(name);
    if (inst === undefined) {
      inst = this.getMeter().createCounter(name, options);
      this.counters.set(name, inst);
    }
    return {
      add: (value, attributes) => inst.add(value, this.guard.sanitize(attributes)),
    };
  }

  upDownCounter(name: string, options?: MetricOptions): CounterHandle {
    let inst = this.upDownCounters.get(name);
    if (inst === undefined) {
      inst = this.getMeter().createUpDownCounter(name, options);
      this.upDownCounters.set(name, inst);
    }
    return {
      add: (value, attributes) => inst.add(value, this.guard.sanitize(attributes)),
    };
  }

  histogram(name: string, options?: MetricOptions): HistogramHandle {
    let inst = this.histograms.get(name);
    if (inst === undefined) {
      inst = this.getMeter().createHistogram(name, options);
      this.histograms.set(name, inst);
    }
    return {
      record: (value, attributes) => inst.record(value, this.guard.sanitize(attributes)),
    };
  }

  gauge(name: string, options?: MetricOptions): GaugeHandle {
    let inst = this.gauges.get(name);
    if (inst === undefined) {
      inst = this.getMeter().createGauge(name, options);
      this.gauges.set(name, inst);
    }
    return {
      record: (value, attributes) => inst.record(value, this.guard.sanitize(attributes)),
    };
  }

  observableCounter(name: string, options?: MetricOptions): ObservableCounter {
    let inst = this.observableCounters.get(name);
    if (inst === undefined) {
      inst = this.getMeter().createObservableCounter(name, options);
      this.observableCounters.set(name, inst);
    }
    return inst;
  }

  observableGauge(name: string, options?: MetricOptions): ObservableGauge {
    let inst = this.observableGauges.get(name);
    if (inst === undefined) {
      inst = this.getMeter().createObservableGauge(name, options);
      this.observableGauges.set(name, inst);
    }
    return inst;
  }

  observableUpDownCounter(name: string, options?: MetricOptions): ObservableUpDownCounter {
    let inst = this.observableUpDownCounters.get(name);
    if (inst === undefined) {
      inst = this.getMeter().createObservableUpDownCounter(name, options);
      this.observableUpDownCounters.set(name, inst);
    }
    return inst;
  }

  sanitizeAttributes(attributes: Attributes | undefined): Attributes | undefined {
    return this.guard.sanitize(attributes);
  }
}

Injectable()(ObserveMetrics);
