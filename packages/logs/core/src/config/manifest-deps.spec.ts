import { readFileSync, readdirSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DENIED_CLIENTS = [
  '@opentelemetry/',
  '@sentry/',
  'pino',
  'winston',
  'bunyan',
  'log4js',
  'elasticsearch',
  '@elastic/',
  '@opensearch-project/',
  'loki',
  'openobserve',
  'express',
  'fastify',
  'rxjs',
  '@nestjs/',
];
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface PackageManifest {
  readonly dependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
  readonly peerDependenciesMeta?: Record<string, { readonly optional?: boolean }>;
}

function readManifest(): PackageManifest {
  const url = new URL('../../package.json', import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as PackageManifest;
}

function typescriptSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return typescriptSources(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('core package manifest (dependency boundary)', () => {
  it('has no runtime dependencies', () => {
    const manifest = readManifest();
    expect(manifest.dependencies).toBeUndefined();
  });

  it('declares no peers, including observability SDKs', () => {
    const manifest = readManifest();
    expect(manifest.peerDependencies ?? {}).toEqual({});
    expect(manifest.peerDependenciesMeta ?? {}).toEqual({});
  });

  it('declares no NestJS dependency in any dependency field', () => {
    const manifest = readManifest();
    const declared = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
    ];
    expect(declared.filter((name) => name.startsWith('@nestjs/'))).toEqual([]);
  });

  it('has no NestJS imports anywhere in core source', () => {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const offenders = typescriptSources(root).filter((path) =>
      /from\s+['"]@nestjs\//.test(readFileSync(path, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('has no HTTP framework import or dependency', () => {
    const frameworks = ['express', 'fastify', 'rxjs', '@nestjs/'];
    const manifest = readManifest();
    const declared = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
    ];
    expect(declared.filter((name) => frameworks.some((f) => name.startsWith(f)))).toEqual([]);

    const root = fileURLToPath(new URL('../', import.meta.url));
    const offenders = typescriptSources(root).filter((path) =>
      frameworks.some((f) => new RegExp(`from\\s+['"][^'"]*${f}`).test(readFileSync(path, 'utf8'))),
    );
    expect(offenders).toEqual([]);
  });

  it('has no logging backend, destination client or observability SDK import or dependency', () => {
    const manifest = readManifest();
    const declared = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
    ];
    expect(
      declared.filter((name) => DENIED_CLIENTS.some((client) => name.startsWith(client))),
    ).toEqual([]);

    const root = fileURLToPath(new URL('../', import.meta.url));
    const offenders = typescriptSources(root).filter((path) => {
      const source = readFileSync(path, 'utf8');
      return DENIED_CLIENTS.some((client) =>
        new RegExp(`from\\s+['"][^'"]*${escapeRegExp(client)}`).test(source),
      );
    });
    expect(offenders).toEqual([]);
  });

  // Syntactic check only: it does not prove module resolution at runtime.
  it('has no dynamic or bare side-effect load of third-party packages', () => {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const allowed = (specifier: string): boolean =>
      specifier.startsWith('node:') ||
      isBuiltin(specifier) ||
      specifier.startsWith('./') ||
      specifier.startsWith('../');
    const dynamicLoad = /\b(?:import|require)\s*\(\s*(['"]?)([^'")]+)\1\s*\)/g;
    const bareImport = /(?:^|\n)\s*import\s+(['"])([^'"]+)\1/g;
    const offenders: string[] = [];
    for (const path of typescriptSources(root)) {
      const source = readFileSync(path, 'utf8');
      for (const match of source.matchAll(dynamicLoad)) {
        const specifier = (match[2] ?? '').trim();
        if (match[1] !== "'" && match[1] !== '"')
          offenders.push(`${path}: non-literal ${specifier}`);
        else if (!allowed(specifier)) offenders.push(`${path}: dynamic ${specifier}`);
      }
      for (const match of source.matchAll(bareImport)) {
        const specifier = match[2] ?? '';
        if (!allowed(specifier)) offenders.push(`${path}: import ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
