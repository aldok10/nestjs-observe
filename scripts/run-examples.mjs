// Compiles the TypeScript examples against the built workspace packages and runs every example.
// Requires `npm run build` first. Exits non-zero if any example fails.
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const examples = join(root, 'examples');
const dist = join(examples, 'dist');

rmSync(dist, { recursive: true, force: true });
execFileSync(join(root, 'node_modules', '.bin', 'tsc'), ['-p', join(examples, 'tsconfig.json')], {
  stdio: 'inherit',
});

const runs = [
  ['standalone', join(examples, 'standalone', 'index.mjs')],
  ['nestjs', join(dist, 'nestjs', 'main.js')],
  ['custom-adapter', join(dist, 'custom-adapter', 'main.js')],
  ['custom-formatter', join(dist, 'custom-formatter', 'main.js')],
  ['custom-transport', join(dist, 'custom-transport', 'main.js')],
  ['multiple-adapters', join(dist, 'multiple-adapters', 'main.js')],
];

let failed = 0;
for (const [name, entry] of runs) {
  try {
    const output = execFileSync('node', [entry], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    console.log(`PASS ${name}\n${output.trim().replace(/^/gm, '  ')}`);
  } catch (error) {
    failed += 1;
    console.log(
      `FAIL ${name}\n${String(error.stderr ?? error.message)
        .trim()
        .replace(/^/gm, '  ')}`,
    );
  }
}
rmSync(dist, { recursive: true, force: true });
console.log(`${runs.length - failed}/${runs.length} examples passed`);
process.exit(failed === 0 ? 0 : 1);
