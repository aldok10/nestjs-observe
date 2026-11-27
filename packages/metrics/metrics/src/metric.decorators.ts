import { metrics } from '@opentelemetry/api';
import type { MetricDecoratorOptions } from './metrics.contracts.js';

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    'then' in value &&
    typeof value.then === 'function'
  );
}

function resolveMetricName(
  target: object,
  propertyKey: string | symbol,
  options: MetricDecoratorOptions,
  suffix: string,
): string {
  if (options.name !== undefined) return options.name;
  const className =
    typeof target === 'function' ? target.name : (target.constructor?.name ?? 'UnknownClass');
  return `${className}.${String(propertyKey)}.${suffix}`;
}

export function MetricCounter(nameOrOptions?: string | MetricDecoratorOptions): MethodDecorator {
  const options: MetricDecoratorOptions =
    typeof nameOrOptions === 'string' ? { name: nameOrOptions } : (nameOrOptions ?? {});

  return (target, propertyKey, descriptor: PropertyDescriptor) => {
    const original: unknown = descriptor.value;
    if (typeof original !== 'function') return descriptor;
    const metricName = resolveMetricName(target, propertyKey, options, 'calls');

    descriptor.value = function countedMethod(this: unknown, ...args: unknown[]): unknown {
      const counter = metrics
        .getMeter('@aldok10/nestjs-observe-metrics')
        .createCounter(metricName, {
          ...(options.description !== undefined ? { description: options.description } : {}),
          ...(options.unit !== undefined ? { unit: options.unit } : {}),
        });

      try {
        const result = original.apply(this, args);
        if (isPromiseLike(result)) {
          return result.then(
            (resolved) => {
              counter.add(1, { status: 'ok' });
              return resolved;
            },
            (error: unknown) => {
              counter.add(1, { status: 'error' });
              throw error;
            },
          );
        }
        counter.add(1, { status: 'ok' });
        return result;
      } catch (error: unknown) {
        counter.add(1, { status: 'error' });
        throw error;
      }
    };

    return descriptor;
  };
}

export function MetricHistogram(nameOrOptions?: string | MetricDecoratorOptions): MethodDecorator {
  const options: MetricDecoratorOptions =
    typeof nameOrOptions === 'string' ? { name: nameOrOptions } : (nameOrOptions ?? {});

  return (target, propertyKey, descriptor: PropertyDescriptor) => {
    const original: unknown = descriptor.value;
    if (typeof original !== 'function') return descriptor;
    const metricName = resolveMetricName(target, propertyKey, options, 'duration_ms');

    descriptor.value = function timedMethod(this: unknown, ...args: unknown[]): unknown {
      const histogram = metrics
        .getMeter('@aldok10/nestjs-observe-metrics')
        .createHistogram(metricName, {
          unit: options.unit ?? 'ms',
          ...(options.description !== undefined ? { description: options.description } : {}),
        });
      const startedAt = performance.now();

      try {
        const result = original.apply(this, args);
        if (isPromiseLike(result)) {
          return result.then(
            (resolved) => {
              histogram.record(performance.now() - startedAt, { status: 'ok' });
              return resolved;
            },
            (error: unknown) => {
              histogram.record(performance.now() - startedAt, { status: 'error' });
              throw error;
            },
          );
        }
        histogram.record(performance.now() - startedAt, { status: 'ok' });
        return result;
      } catch (error: unknown) {
        histogram.record(performance.now() - startedAt, { status: 'error' });
        throw error;
      }
    };

    return descriptor;
  };
}
