import {
  context,
  ROOT_CONTEXT,
  trace,
  type Context,
  type ContextManager,
} from '@opentelemetry/api';
import { LogContextStore } from '@aldok10/nestjs-observe-logger-core/context';
import { describe, expect, it } from 'vitest';
import { createActiveSpanProvider, fromActiveSpan, withActiveSpan } from './index.js';

let active: Context = ROOT_CONTEXT;
const manager: ContextManager = {
  active: () => active,
  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    ctx: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    const previous = active;
    active = ctx;
    try {
      return Reflect.apply(fn, thisArg, args) as ReturnType<F>;
    } finally {
      active = previous;
    }
  },
  bind<T>(_ctx: Context, target: T): T {
    return target;
  },
  enable: () => manager,
  disable: () => manager,
};
context.setGlobalContextManager(manager);

describe('OpenTelemetry trace correlation', () => {
  it('returns {} without an active span', () => {
    expect(fromActiveSpan()).toEqual({});
  });

  it('reads traceId and spanId from the active span', () => {
    const span = trace.getTracer('cisea-logger-test').startSpan('work');
    const correlated = context.with(trace.setSpan(context.active(), span), () => fromActiveSpan());
    span.end();

    expect(correlated).toEqual({
      traceId: span.spanContext().traceId,
      spanId: span.spanContext().spanId,
    });
  });

  it('lets explicit context win over span metadata', () => {
    const span = trace.getTracer('cisea-logger-test').startSpan('work');
    const merged = context.with(trace.setSpan(context.active(), span), () =>
      withActiveSpan({ traceId: 'explicit' }),
    );
    span.end();

    expect(merged.traceId).toBe('explicit');
    expect(merged.spanId).toBe(span.spanContext().spanId);
  });

  it('feeds correlation into a core LogContextStore', () => {
    const span = trace.getTracer('cisea-logger-test').startSpan('work');
    const store = new LogContextStore({ activeSpanProvider: createActiveSpanProvider() });
    const correlated = context.with(trace.setSpan(context.active(), span), () =>
      store.fromActiveSpan(),
    );
    span.end();

    expect(correlated.traceId).toBe(span.spanContext().traceId);
    expect(new LogContextStore().fromActiveSpan()).toEqual({});
  });
});
