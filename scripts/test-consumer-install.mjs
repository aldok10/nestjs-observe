// Packs workspace packages with `npm pack` and installs the tarballs into isolated
// temporary consumer projects (no workspace symlinks) to verify standalone
// independence and Observer composition across ESM and CJS.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const keep = process.argv.includes('--keep');
const work = mkdtempSync(join(tmpdir(), 'nestjs-observe-consumer-'));
const packDir = join(work, 'tarballs');
const packStage = join(work, 'stage');
mkdirSync(packDir);

const PACKAGE_PATHS = {
  core: ['packages/core', '@aldok10/nestjs-observe-core'],
  loggerCore: ['packages/logs/core', '@aldok10/nestjs-observe-logger-core'],
  loggerTransports: ['packages/logs/transports', '@aldok10/nestjs-observe-logger-transports'],
  loggerFormatters: ['packages/logs/formatters', '@aldok10/nestjs-observe-logger-formatters'],
  loggerDelivery: ['packages/logs/delivery', '@aldok10/nestjs-observe-logger-delivery'],
  logger: ['packages/logs/logger', '@aldok10/nestjs-observe-logger'],
  loggerTesting: ['packages/logs/testing', '@aldok10/nestjs-observe-logger-testing'],
  tracing: ['packages/traces/tracing', '@aldok10/nestjs-observe-tracing'],
  tracingTesting: ['packages/traces/testing', '@aldok10/nestjs-observe-tracing-testing'],
  metrics: ['packages/metrics/metrics', '@aldok10/nestjs-observe-metrics'],
  metricsTesting: ['packages/metrics/testing', '@aldok10/nestjs-observe-metrics-testing'],
  errorTracking: [
    'packages/traces/error-tracking/error-tracking',
    '@aldok10/nestjs-observe-error-tracking',
  ],
  errorTrackingOtlp: [
    'packages/traces/error-tracking/adapter-otlp',
    '@aldok10/nestjs-observe-error-tracking-otlp',
  ],
  observer: ['packages/observer/observer', '@aldok10/nestjs-observe'],
};

const NEST_PEERS = ['@nestjs/common@^12', '@nestjs/core@^12', 'reflect-metadata@^0.2', 'rxjs@^7'];
const results = [];

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function check(scenario, label, fn) {
  try {
    fn();
    results.push({ scenario, label, ok: true });
  } catch (error) {
    const detail = String(error.stderr ?? error.stdout ?? error.message)
      .trim()
      .split('\n')
      .slice(-8)
      .join('\n');
    results.push({ scenario, label, ok: false, detail });
  }
}

for (const [_key, [relDir, name]] of Object.entries(PACKAGE_PATHS)) {
  const pkgDir = join(root, relDir);
  if (!['index.js', 'index.cjs', 'index.d.ts'].every((f) => existsSync(join(pkgDir, 'dist', f)))) {
    console.error(`missing built dist/index.{js,cjs,d.ts} for ${name}; run pnpm run build first`);
    process.exit(1);
  }
  if (!existsSync(join(pkgDir, 'LICENSE'))) {
    console.error(`missing LICENSE for ${name}`);
    process.exit(1);
  }
}

const tarballs = {};
for (const [key, [relDir, name]] of Object.entries(PACKAGE_PATHS)) {
  const pkgDir = join(root, relDir);
  const stageDir = join(packStage, key);
  cpSync(pkgDir, stageDir, {
    recursive: true,
    filter: (src) => !src.split(/[\\/]/).includes('node_modules'),
  });
  const [info] = JSON.parse(
    run('npm', ['pack', '--pack-destination', packDir, '--json'], stageDir),
  );
  tarballs[key] = join(packDir, info.filename);
  check('pack', `${name} (${info.entryCount} files, ${info.size} B)`, () => {
    const manifest = JSON.parse(
      run('tar', ['-xzOf', tarballs[key], 'package/package.json'], packDir),
    );
    if (JSON.stringify(manifest).includes('workspace:')) {
      throw new Error('packed manifest contains workspace: ranges');
    }
    const files = info.files.map((f) => f.path);
    if (files.some((f) => f.startsWith('src/') || f.endsWith('.spec.ts'))) {
      throw new Error('tarball ships source or specs');
    }
  });
}

function consumer(name, specs) {
  const dir = join(work, name);
  mkdirSync(dir);
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: `consumer-${name}`, private: true, type: 'module' }),
  );
  run(
    'npm',
    ['install', '--no-audit', '--no-fund', '--prefer-offline', '--loglevel=error', ...specs],
    dir,
  );
  return dir;
}

function installed(dir, pkg) {
  return existsSync(join(dir, 'node_modules', ...pkg.split('/'), 'package.json'));
}

function assertAbsent(dir, pkgs) {
  const leaked = pkgs.filter((pkg) => installed(dir, pkg));
  if (leaked.length > 0) throw new Error(`unexpectedly installed: ${leaked.join(', ')}`);
}

function node(dir, file, source) {
  writeFileSync(join(dir, file), source);
  return run('node', [file], dir);
}

// 1. Core alone
{
  const s = 'core-only';
  let dir;
  check(s, 'install core tarball alone', () => {
    dir = consumer(s, [tarballs.core]);
  });
  check(s, 'no domain or vendor packages installed', () =>
    assertAbsent(dir, [
      '@nestjs/common',
      '@opentelemetry/api',
      '@aldok10/nestjs-observe-logger',
      '@aldok10/nestjs-observe-tracing',
      '@aldok10/nestjs-observe-metrics',
      '@aldok10/nestjs-observe',
    ]),
  );
  check(s, 'ESM + CJS import and ResourceMetadata/ObserveContextStore work', () => {
    const body = (imp) => `
      const { createResourceMetadata, ObserveContextStore } = ${imp('@aldok10/nestjs-observe-core')};
      const meta = createResourceMetadata({ serviceName: 'core-test' });
      if (meta.serviceName !== 'core-test') throw new Error('resource mismatch');
      const store = new ObserveContextStore();
      store.run({ requestId: 'r1' }, () => { if (store.get().requestId !== 'r1') throw new Error('context mismatch'); });
    `;
    node(
      dir,
      'test.mjs',
      body((m) => `await import('${m}')`),
    );
    node(
      dir,
      'test.cjs',
      body((m) => `require('${m}')`),
    );
  });
}

// 2. Logger standalone
{
  const s = 'logger-standalone';
  let dir;
  check(s, 'install logger + NestJS peers without tracing/metrics/observer', () => {
    dir = consumer(s, [
      tarballs.core,
      tarballs.loggerCore,
      tarballs.loggerFormatters,
      tarballs.loggerDelivery,
      tarballs.loggerTransports,
      tarballs.logger,
      ...NEST_PEERS,
    ]);
  });
  check(s, 'no tracing, metrics, or observer installed', () =>
    assertAbsent(dir, [
      '@opentelemetry/api',
      '@opentelemetry/sdk-trace',
      '@opentelemetry/sdk-metrics',
      '@aldok10/nestjs-observe-tracing',
      '@aldok10/nestjs-observe-metrics',
      '@aldok10/nestjs-observe',
    ]),
  );
  check(s, 'ESM NestJS LoggerModule boots and logs', () => {
    node(
      dir,
      'app.mjs',
      `
      import 'reflect-metadata';
      import { Module } from '@nestjs/common';
      import { NestFactory } from '@nestjs/core';
      import { ObserveLoggerModule, OBSERVE_LOGGER } from '@aldok10/nestjs-observe-logger';
      class AppModule {}
      Module({ imports: [ObserveLoggerModule.forRoot({ level: 'info' })] })(AppModule);
      const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
      app.get(OBSERVE_LOGGER).info('standalone logger ok');
      await app.close();
      `,
    );
  });
}

// 3. Tracing standalone
{
  const s = 'tracing-standalone';
  let dir;
  check(s, 'install tracing + NestJS peers without logger/metrics/observer', () => {
    dir = consumer(s, [tarballs.core, tarballs.tracing, ...NEST_PEERS]);
  });
  check(s, 'no logger, metrics, or observer installed', () =>
    assertAbsent(dir, [
      '@aldok10/nestjs-observe-logger',
      '@aldok10/nestjs-observe-logger-core',
      '@aldok10/nestjs-observe-metrics',
      '@aldok10/nestjs-observe',
    ]),
  );
  check(s, 'ESM NestJS TracingModule boots, creates span, and shuts down', () => {
    node(
      dir,
      'app.mjs',
      `
      import 'reflect-metadata';
      import { Module } from '@nestjs/common';
      import { NestFactory } from '@nestjs/core';
      import { TracingModule, ObserveTracer } from '@aldok10/nestjs-observe-tracing';
      class AppModule {}
      Module({ imports: [TracingModule.forRoot({ resource: { serviceName: 't-svc' } })] })(AppModule);
      const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
      const tracer = app.get(ObserveTracer);
      const out = await tracer.withSpan('op', async () => 'ok');
      if (out !== 'ok') throw new Error('unexpected span result');
      await app.close();
      `,
    );
  });
}

// 4. Metrics standalone
{
  const s = 'metrics-standalone';
  let dir;
  check(s, 'install metrics + NestJS peers without logger/tracing/observer', () => {
    dir = consumer(s, [tarballs.core, tarballs.metrics, ...NEST_PEERS]);
  });
  check(s, 'no logger, tracing, or observer installed', () =>
    assertAbsent(dir, [
      '@aldok10/nestjs-observe-logger',
      '@aldok10/nestjs-observe-logger-core',
      '@aldok10/nestjs-observe-tracing',
      '@aldok10/nestjs-observe',
    ]),
  );
  check(s, 'ESM NestJS MetricsModule boots, records metric, and shuts down', () => {
    node(
      dir,
      'app.mjs',
      `
      import 'reflect-metadata';
      import { Module } from '@nestjs/common';
      import { NestFactory } from '@nestjs/core';
      import { MetricsModule, ObserveMetrics } from '@aldok10/nestjs-observe-metrics';
      class AppModule {}
      Module({ imports: [MetricsModule.forRoot({ resource: { serviceName: 'm-svc' } })] })(AppModule);
      const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
      app.get(ObserveMetrics).counter('req.count').add(1);
      await app.close();
      `,
    );
  });
}

// 4b. Error tracking standalone
{
  const s = 'error-tracking-standalone';
  let dir;
  check(
    s,
    'install error-tracking + otlp + NestJS peers without logger/tracing/metrics/observer',
    () => {
      dir = consumer(s, [
        tarballs.core,
        tarballs.errorTracking,
        tarballs.errorTrackingOtlp,
        ...NEST_PEERS,
      ]);
    },
  );
  check(s, 'no logger, tracing, metrics, or observer installed', () =>
    assertAbsent(dir, [
      '@aldok10/nestjs-observe-logger',
      '@aldok10/nestjs-observe-logger-core',
      '@aldok10/nestjs-observe-tracing',
      '@aldok10/nestjs-observe-metrics',
      '@aldok10/nestjs-observe',
    ]),
  );
  check(s, 'ESM NestJS ErrorTrackingModule + bridges import cleanly', () => {
    node(
      dir,
      'app.mjs',
      `
      import 'reflect-metadata';
      import { Module } from '@nestjs/common';
      import { NestFactory } from '@nestjs/core';
      import { ErrorTrackingModule, ObserveErrorTracker } from '@aldok10/nestjs-observe-error-tracking';
      import { createErrorTrackingLogTransport } from '@aldok10/nestjs-observe-error-tracking/bridges';
      import { createOtlpErrorAdapter } from '@aldok10/nestjs-observe-error-tracking-otlp';
      class AppModule {}
      Module({
        imports: [
          ErrorTrackingModule.forRoot({
            resource: { serviceName: 'et-svc' },
            destinations: [{ name: 'otlp', adapter: createOtlpErrorAdapter({ endpoint: 'http://127.0.0.1:4318' }), enabled: false }],
          }),
        ],
      })(AppModule);
      const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
      const tracker = app.get(ObserveErrorTracker);
      const bridge = createErrorTrackingLogTransport(tracker);
      if (bridge.name !== 'error-tracking-bridge') throw new Error('unexpected bridge name');
      await app.close();
      `,
    );
  });
}

// 5. Observer with logger only (tracing & metrics absent)
{
  const s = 'observer+logger-only';
  let dir;
  check(s, 'install observer + logger only (tracing & metrics absent)', () => {
    dir = consumer(s, [
      tarballs.core,
      tarballs.loggerCore,
      tarballs.loggerFormatters,
      tarballs.loggerDelivery,
      tarballs.loggerTransports,
      tarballs.logger,
      tarballs.observer,
      ...NEST_PEERS,
    ]);
  });
  check(s, 'tracing & metrics absent', () =>
    assertAbsent(dir, ['@aldok10/nestjs-observe-tracing', '@aldok10/nestjs-observe-metrics']),
  );
  check(s, 'ObserverModule.forRoot({ logger: true }) works without tracing or metrics', () => {
    node(
      dir,
      'app.mjs',
      `
      import 'reflect-metadata';
      import { Module } from '@nestjs/common';
      import { NestFactory } from '@nestjs/core';
      import { ObserverModule, ObserverService } from '@aldok10/nestjs-observe';
      class AppModule {}
      Module({ imports: [ObserverModule.forRoot({ logger: true })] })(AppModule);
      const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
      const obs = app.get(ObserverService);
      if (!obs.logger || obs.tracer || obs.metrics) throw new Error('unexpected domain state');
      obs.logger.info('observer logger-only ok');
      await app.close();
      `,
    );
  });
}

// 6. Observer with all 3 domains
{
  const s = 'observer+all';
  let dir;
  check(s, 'install observer + all 3 domains', () => {
    dir = consumer(s, [
      tarballs.core,
      tarballs.loggerCore,
      tarballs.loggerFormatters,
      tarballs.loggerDelivery,
      tarballs.loggerTransports,
      tarballs.logger,
      tarballs.loggerTesting,
      tarballs.tracing,
      tarballs.metrics,
      tarballs.observer,
      ...NEST_PEERS,
    ]);
  });
  check(s, 'ObserverModule.forRoot composes logger + tracing + metrics with correlation', () => {
    node(
      dir,
      'app.mjs',
      `
      import 'reflect-metadata';
      import { Module } from '@nestjs/common';
      import { NestFactory } from '@nestjs/core';
      import { CaptureTransport } from '@aldok10/nestjs-observe-logger-testing';
      import { ObserverModule, ObserverService } from '@aldok10/nestjs-observe';
      const capture = new CaptureTransport();
      class AppModule {}
      Module({
        imports: [
          ObserverModule.forRoot({
            resource: { serviceName: 'all-svc' },
            logger: { enabled: true, transports: [capture] },
            tracing: { enabled: true },
            metrics: { enabled: true },
          }),
        ],
      })(AppModule);
      const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
      const obs = app.get(ObserverService);
      await obs.tracer.withSpan('unified.op', async (span) => {
        obs.logger.info('correlated');
        obs.metrics.counter('unified.count').add(1);
        if (capture.records[0]?.traceId !== span.spanContext().traceId) {
          throw new Error('traceId correlation failed');
        }
      });
      await app.close();
      `,
    );
  });
}

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'} [${r.scenario}] ${r.label}`);
  if (!r.ok) console.log(`  ${r.detail.replace(/\n/g, '\n  ')}`);
}
if (!keep) rmSync(work, { recursive: true, force: true });
else console.log(`kept temp dir: ${work}`);

if (failed.length > 0) process.exit(1);
