import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const allowed = new Set([10, 11, 12]);
const expectedRaw = process.env['NEST_MAJOR'] ?? process.env['EXPECT_NEST_MAJOR'];
const expected = expectedRaw === undefined ? undefined : Number(expectedRaw);

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

if (expected !== undefined && !allowed.has(expected)) {
  fail(`expected NestJS major ${String(expectedRaw)} is outside the CI matrix (10, 11, 12)`);
}

function installed(packageName) {
  let version;
  try {
    version = JSON.parse(
      readFileSync(join(root, 'node_modules', packageName, 'package.json'), 'utf8'),
    ).version;
  } catch {
    fail(`${packageName} is not installed; run npm install first`);
  }
  const match = /^(\d+)\./.exec(version);
  if (match === null) fail(`cannot read major version from ${packageName}@${version}`);
  return { version, major: Number(match[1]) };
}

const common = installed('@nestjs/common');
const core = installed('@nestjs/core');

for (const item of [common, core]) {
  if (!allowed.has(item.major)) {
    fail(`installed NestJS major ${item.major} is outside the CI matrix (10, 11, 12)`);
  }
  if (expected !== undefined && item.major !== expected) {
    fail(`expected NestJS major ${expected}, found ${item.major} (${item.version})`);
  }
}

if (common.major !== core.major) {
  fail(`@nestjs/common@${common.version} and @nestjs/core@${core.version} majors differ`);
}

console.log(
  `nest matrix check passed: @nestjs/common@${common.version}, @nestjs/core@${core.version}${expected === undefined ? '' : ` (expected ${expected})`}`,
);
