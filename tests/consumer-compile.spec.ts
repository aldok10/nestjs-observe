import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsc = join(root, 'node_modules', '.bin', 'tsc');
const hasDist =
  existsSync(join(root, 'packages/core/dist/index.js')) &&
  existsSync(join(root, 'packages/nestjs-logger/dist/index.js'));

// Type resolution needs built dist and workspace links; without them the check is not meaningful.
describe.skipIf(!hasDist)('consumer type resolution', () => {
  it('compiles the same snippet in NodeNext and Bundler modes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cisea-logger-compile-'));
    try {
      symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir');
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
      writeFileSync(
        join(dir, 'app.ts'),
        `import { LoggerModule } from '@aldok10/nestjs-observe-logger';
import type { LogRecord } from '@aldok10/nestjs-observe-logger-core';
import type { LogContext } from '@aldok10/nestjs-observe-logger-core/contracts';
LoggerModule.forRoot({ level: 'info' });
export function describeRecord(record: LogRecord, context: LogContext): string {
  return record.message + (context.context ?? '');
}
`,
      );
      const config = (module: string, moduleResolution: string) =>
        JSON.stringify({
          compilerOptions: {
            target: 'ES2023',
            lib: ['ES2023'],
            module,
            moduleResolution,
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            types: ['node'],
            verbatimModuleSyntax: true,
            isolatedModules: true,
          },
          files: ['app.ts'],
        });
      writeFileSync(join(dir, 'tsconfig.nodenext.json'), config('NodeNext', 'NodeNext'));
      writeFileSync(join(dir, 'tsconfig.bundler.json'), config('ESNext', 'Bundler'));
      for (const project of ['tsconfig.nodenext.json', 'tsconfig.bundler.json']) {
        const output = execFileSync(tsc, ['-p', project], { cwd: dir, encoding: 'utf8' });
        expect(output).toBe('');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
