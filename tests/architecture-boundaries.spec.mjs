import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importViolation, roleForbiddenEdge } from '../scripts/architecture-rules.mjs';

const CORE = '@aldok10/nestjs-observe-logger-core';
const OTEL = '@aldok10/nestjs-observe-logger-context';
const MAIN = '@aldok10/nestjs-observe-logger';
const OPTIONAL = new Set(['@opentelemetry/api', 'rxjs']);

describe('role-based edges', () => {
  it('allows core, shared delivery/format bases, and main -> transport', () => {
    expect(roleForbiddenEdge(`${MAIN}-adapter-pino`, CORE)).toBeNull();
    expect(roleForbiddenEdge(`${MAIN}-transports`, `${MAIN}-delivery`)).toBeNull();
    expect(roleForbiddenEdge(MAIN, `${MAIN}-transports`)).toBeNull();
  });

  it('rejects adapter -> transport, transport -> transport, integration -> integration', () => {
    expect(roleForbiddenEdge(`${MAIN}-adapter-pino`, `${MAIN}-transports`)).toBe(
      'backend-adapter-to-destination-transport',
    );
    expect(roleForbiddenEdge(`${MAIN}-transports`, `${MAIN}-transports`)).toBe(
      'transport-to-transport',
    );
    expect(roleForbiddenEdge(MAIN, `${MAIN}-sentry`)).toBe('integration-to-unrelated-integration');
  });
});

describe('optional peers', () => {
  it('flags eager imports even in the declaring owner, but accepts type-only and import()', () => {
    const common = {
      pkg: OTEL,
      specifier: '@opentelemetry/api',
      optionalPeers: OPTIONAL,
      declared: new Set(['@opentelemetry/api']),
    };
    expect(importViolation(common)).toMatch(/optional peer/);
    expect(importViolation({ ...common, isTypeOnly: true })).toBeNull();
    expect(importViolation({ ...common, isDynamic: true })).toBeNull();
  });

  it('applies the same check to other packages', () => {
    expect(
      importViolation({
        pkg: `${MAIN}-sentry`,
        specifier: '@opentelemetry/api',
        optionalPeers: OPTIONAL,
      }),
    ).toMatch(/optional peer/);
  });
});

describe('spec imports', () => {
  it('uses a narrow fixture allowlist but keeps forbidden checks', () => {
    expect(
      importViolation({ pkg: MAIN, specifier: 'pino', isSpec: true, forbiddenPrefixes: ['pino'] }),
    ).toBeNull();
    expect(
      importViolation({
        pkg: `${MAIN}-transport-file`,
        specifier: 'pino',
        isSpec: true,
        forbiddenPrefixes: ['pino'],
      }),
    ).toBe('forbidden import "pino"');
    expect(
      importViolation({
        pkg: CORE,
        specifier: '@nestjs/common',
        isSpec: true,
        forbiddenPrefixes: ['@nestjs/'],
      }),
    ).toBe('forbidden import "@nestjs/common"');
  });

  it('keeps undeclared checks prod-only', () => {
    expect(importViolation({ pkg: OTEL, specifier: 'left-pad' })).toBe(
      'undeclared dependency "left-pad"',
    );
    expect(importViolation({ pkg: OTEL, specifier: 'left-pad', isSpec: true })).toBeNull();
  });
});

describe('checker on synthetic fixtures', () => {
  const script = resolve('scripts/check-architecture.mjs');
  let fixture;
  let pkgDir;

  const manifest = (name, extra = {}) => ({
    name,
    version: '0.1.1',
    type: 'module',
    license: 'MIT',
    publishConfig: { access: 'public' },
    files: ['dist'],
    exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
    ...extra,
  });

  it('flags a synthetic eager optional-peer import and accepts the lazy form', () => {
    fixture = mkdtempSync(join(tmpdir(), 'arch-boundary-'));
    pkgDir = join(fixture, 'packages');
    for (const [dir, data] of [
      ['core', manifest(CORE)],
      [
        'nestjs-logger-opentelemetry',
        manifest(OTEL, {
          dependencies: { [CORE]: '^0.1.1' },
          peerDependencies: { '@opentelemetry/api': '^1.0.0' },
          peerDependenciesMeta: { '@opentelemetry/api': { optional: true } },
        }),
      ],
    ]) {
      mkdirSync(join(pkgDir, dir, 'src'), { recursive: true });
      writeFileSync(join(pkgDir, dir, 'package.json'), JSON.stringify(data));
    }
    const source = join(pkgDir, 'nestjs-logger-opentelemetry', 'src', 'index.ts');
    const eager = "import { trace } from '@opentelemetry/api';\nexport const value = trace;\n";
    writeFileSync(source, eager);

    expect(() => execFileSync('node', [script, '--root', fixture], { stdio: 'pipe' })).toThrow(
      /optional peer/,
    );
    writeFileSync(
      source,
      "import type { TracerProvider } from '@opentelemetry/api';\nexport type Api = TracerProvider;\n",
    );
    expect(() =>
      execFileSync('node', [script, '--root', fixture], { stdio: 'pipe' }),
    ).not.toThrow();
    rmSync(fixture, { recursive: true, force: true });
  });
});
