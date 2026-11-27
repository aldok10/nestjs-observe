#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const getArg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

if (has('--help') || has('-h')) {
  console.log(`Usage: node scripts/check-publish-versions.mjs [options]

Checks workspace package versions against npm registry and records status.

Options:
  --registry <url>   npm registry (default: https://registry.npmjs.org)
  --out <file>       write JSON report (default: reports/publish-version-check.json)
  --publish          publish only packages whose local version is not on registry
  --dry-run          with --publish, pass --dry-run to pnpm publish
  --no-record        do not write report file
  --json             print JSON report to stdout
  --help             show help
`);
  process.exit(0);
}

const registry = getArg('--registry') || 'https://registry.npmjs.org';
const outFile = getArg('--out') || 'reports/publish-version-check.json';
const doPublish = has('--publish');
const dryRun = has('--dry-run');
const noRecord = has('--no-record');
const jsonOut = has('--json');

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      walk(p, out);
    } else if (e.name === 'package.json' && p.split(path.sep).includes('packages')) {
      out.push(p);
    }
  }
  return out;
}

function npmView(name, version) {
  try {
    const out = execFileSync(
      'npm',
      ['view', `${name}@${version}`, 'version', '--registry', registry, '--json'],
      {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30000,
      },
    ).trim();
    const parsed = JSON.parse(out);
    const v = Array.isArray(parsed) ? parsed[0] : parsed;
    return { published: true, publishedVersion: String(v) };
  } catch (e) {
    const stderr = String(e.stderr || e.message || '');
    if (/E404|404|Not Found/i.test(stderr)) return { published: false, publishedVersion: null };
    return { published: false, publishedVersion: null, error: stderr.split('\n')[0].slice(0, 200) };
  }
}

async function mapLimit(items, limit, fn) {
  const res = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        res[idx] = await fn(items[idx], idx);
      }
    }),
  );
  return res;
}

const pkgFiles = walk(path.join(root, 'packages'));
const pkgs = pkgFiles
  .map((f) => ({ file: f, pkg: JSON.parse(readFileSync(f, 'utf8')) }))
  .filter(({ pkg }) => !pkg.private && pkg.name && pkg.version)
  .map(({ file, pkg }) => ({ name: pkg.name, version: pkg.version, dir: path.dirname(file) }))
  .sort((a, b) => a.name.localeCompare(b.name));

const checked = await mapLimit(pkgs, 8, async (p) => {
  const r = npmView(p.name, p.version);
  const sameVersionPublished = r.published && r.publishedVersion === p.version;
  const status = r.error ? 'error' : sameVersionPublished ? 'skip-same-version' : 'publish';
  return { ...p, ...r, sameVersionPublished, status };
});

const summary = {
  checkedAt: new Date().toISOString(),
  registry,
  total: checked.length,
  publish: checked.filter((p) => p.status === 'publish').length,
  skipSameVersion: checked.filter((p) => p.status === 'skip-same-version').length,
  error: checked.filter((p) => p.status === 'error').length,
};

const report = { summary, packages: checked };

if (!noRecord) {
  const absOut = path.isAbsolute(outFile) ? outFile : path.join(root, outFile);
  mkdirSync(path.dirname(absOut), { recursive: true });
  writeFileSync(absOut, JSON.stringify(report, null, 2) + '\n');
}

if (jsonOut) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Registry: ${registry}`);
  console.log(
    `Total: ${summary.total} | publish: ${summary.publish} | skip-same-version: ${summary.skipSameVersion} | error: ${summary.error}`,
  );
  if (!noRecord) console.log(`Report: ${outFile}`);
  for (const p of checked) {
    const mark =
      p.status === 'skip-same-version' ? 'SKIP' : p.status === 'publish' ? 'PUBLISH' : 'ERROR';
    const detail = p.error
      ? ` (${p.error})`
      : p.published
        ? `npm=${p.publishedVersion}`
        : 'not-on-registry';
    console.log(`${mark}\t${p.name}@${p.version}\t${detail}`);
  }
}

if (doPublish) {
  const toPublish = checked.filter((p) => p.status === 'publish');
  console.log(`\nPublishing ${toPublish.length} package(s)...`);
  let failed = 0;
  for (const p of toPublish) {
    const cmd = [
      'pnpm',
      'publish',
      '--access',
      'public',
      '--no-git-checks',
      '--registry',
      registry,
    ];
    if (dryRun) cmd.push('--dry-run');
    console.log(`\n==> ${p.name}@${p.version}`);
    try {
      execFileSync(cmd[0], cmd.slice(1), { cwd: p.dir, stdio: 'inherit', timeout: 180000 });
    } catch (e) {
      failed++;
      console.error(`FAILED ${p.name}@${p.version}: exit ${e.status ?? 'unknown'}`);
    }
  }
  if (failed > 0) {
    console.error(`\nPublish finished with ${failed} failure(s).`);
    process.exit(1);
  }
  console.log('\nPublish finished.');
}
