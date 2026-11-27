import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface PackageManifest {
  readonly name?: string;
  readonly dependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
}

const ADAPTER_PACKAGES = [
  'adapter-pino',
  'adapter-winston',
  'adapter-bunyan',
  'adapter-log4js',
] as const;

const BACKEND_PEERS = ['pino', 'winston', 'bunyan', 'log4js'] as const;

function readPackageManifest(pkg: string): PackageManifest {
  const url = new URL(`../../../${pkg}/package.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as PackageManifest;
}

function allDeps(manifest: PackageManifest): string[] {
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ];
}

describe('backend adapter dependency isolation', () => {
  it.each(ADAPTER_PACKAGES)('%s depends on core and owns only its backend peer', (pkg) => {
    const manifest = readPackageManifest(pkg);
    const deps = allDeps(manifest);

    expect(deps).toContain('@aldok10/nestjs-observe-logger-core');

    for (const other of ADAPTER_PACKAGES) {
      if (other === pkg) continue;
      expect(deps).not.toContain(`@aldok10/nestjs-observe-logger-${other}`);
    }

    for (const backend of BACKEND_PEERS) {
      const expected = pkg.endsWith(backend);
      if (expected) expect(Object.keys(manifest.peerDependencies ?? {})).toContain(backend);
      else expect(deps).not.toContain(backend);
    }

    expect(deps).not.toContain('@nestjs/devtools-integration');
    expect(deps.filter((d) => d.includes('devtools'))).toEqual([]);
  });
});
