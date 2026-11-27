import type * as NodePath from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  BoundedExecution,
  LifecycleCoordinator,
  NoopDiagnosticsSink,
  ObserveContextStore,
  OptionalPeerLoader,
  OptionalPeerMissingException,
  ShutdownException,
  StderrDiagnosticsSink,
  createResourceMetadata,
  mergeResourceMetadata,
  toSemanticResourceAttributes,
} from './index.js';

describe('ResourceMetadata', () => {
  it('normalizes and merges resource metadata into semantic attributes', () => {
    const base = createResourceMetadata({
      serviceName: 'billing',
      environment: 'staging',
      attributes: { region: 'ap-southeast-1' },
    });
    const merged = mergeResourceMetadata(base, {
      serviceVersion: '1.2.3',
      attributes: { zone: 'az1' },
    });
    expect(toSemanticResourceAttributes(merged)).toEqual({
      'service.name': 'billing',
      'service.version': '1.2.3',
      'deployment.environment.name': 'staging',
      region: 'ap-southeast-1',
      zone: 'az1',
    });
  });
});

describe('LifecycleCoordinator', () => {
  it('rolls back initialized participants when a later participant fails', async () => {
    const events: string[] = [];
    const coordinator = new LifecycleCoordinator();
    coordinator.register(
      {
        name: 'first',
        initialize: () => {
          events.push('init:first');
        },
        shutdown: async () => {
          events.push('stop:first');
        },
      },
      {
        name: 'second',
        initialize: () => {
          throw new Error('boom');
        },
        shutdown: async () => {
          events.push('stop:second');
        },
      },
    );

    await expect(coordinator.initializeAll()).rejects.toThrow('boom');
    expect(events).toEqual(['init:first', 'stop:first']);
  });

  it('flushes, shuts down in reverse order, and aggregates shutdown failures', async () => {
    const events: string[] = [];
    const coordinator = new LifecycleCoordinator();
    coordinator.register(
      {
        name: 'alpha',
        flush: async () => {
          events.push('flush:alpha');
        },
        shutdown: async () => {
          events.push('stop:alpha');
        },
      },
      {
        name: 'beta',
        flush: async () => {
          events.push('flush:beta');
        },
        shutdown: async () => {
          events.push('stop:beta');
          throw new Error('close failed');
        },
      },
    );

    await expect(coordinator.shutdown(500)).rejects.toBeInstanceOf(ShutdownException);
    expect(events).toEqual(['flush:alpha', 'flush:beta', 'stop:beta', 'stop:alpha']);
  });

  it('bounds long-running work with BoundedExecution', async () => {
    const bounded = new BoundedExecution();
    const never = new Promise<void>(() => undefined);
    await expect(bounded.run(never, 10)).rejects.toThrow('timed out after 10ms');
  });
});

describe('OptionalPeerLoader', () => {
  it('throws OptionalPeerMissingException when a peer is absent', () => {
    const loader = new OptionalPeerLoader();
    expect(() => loader.load('nonexistent-pkg-xyz-123', 'test feature')).toThrow(
      OptionalPeerMissingException,
    );
    expect(loader.tryLoad('nonexistent-pkg-xyz-123')).toBeUndefined();
  });

  it('loads built-in node modules and caches them', () => {
    const loader = new OptionalPeerLoader();
    const pathMod = loader.load('node:path', 'path') as typeof NodePath;
    expect(typeof pathMod.join).toBe('function');
  });
});

describe('DiagnosticsSink & ObserveContextStore', () => {
  it('filters diagnostics by minLevel and propagates async context', async () => {
    const chunks: string[] = [];
    const sink = new StderrDiagnosticsSink({
      minLevel: 'warn',
      stream: {
        write: (chunk: string | Uint8Array) => {
          chunks.push(String(chunk));
          return true;
        },
      } as Pick<NodeJS.WriteStream, 'write'>,
    });
    sink.emit({ domain: 'tracing', level: 'info', message: 'ignored' });
    sink.emit({ domain: 'tracing', level: 'error', message: 'failed', error: new Error('e1') });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain('[nestjs-observe:tracing] [ERROR] failed (e1)');

    const noop = new NoopDiagnosticsSink();
    const spy = vi.spyOn(noop, 'emit');
    noop.emit({ domain: 'core', level: 'debug', message: 'noop' });
    expect(spy).toHaveBeenCalledTimes(1);

    const store = new ObserveContextStore();
    await store.run({ requestId: 'req-1', attributes: { a: 1 } }, async () => {
      await store.run({ tenantId: 't-1', attributes: { b: 2 } }, async () => {
        expect(store.get()).toEqual({
          requestId: 'req-1',
          tenantId: 't-1',
          attributes: { a: 1, b: 2 },
        });
      });
      expect(store.get().tenantId).toBeUndefined();
    });
  });
});
