import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(root, 'benchmarks', 'log-throughput.mjs');
// The benchmark reads built dist via bare specifiers; it must fail loudly, not skip,
// when dist or workspace links are absent. This guard only runs once dist exists.
const hasDist = existsSync(join(root, 'packages/core/dist/index.js'));

function run(args: string[] = []): string {
  return execFileSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' });
}

describe.skipIf(!hasDist)('throughput benchmark output', () => {
  it('reports measured rounds, median and checksum', () => {
    const output = run(['--iterations=200']);
    expect(output).not.toMatch(/^SKIP:/m);
    expect(output).toMatch(/\d+ records x \d+ rounds/);
    expect(output).toMatch(/warmup/);
    expect(output).toMatch(/ops\/sec by round:/);
    expect(output).toMatch(/median: .* ops\/sec/);
    expect(output).toMatch(/checksum: records=\d+, bytes=\d+/);
  });

  it('fails loudly on invalid arguments', () => {
    expect(() => run(['--iterations=0'])).toThrow(/invalid --iterations/);
  });
});
