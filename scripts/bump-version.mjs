#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const getArg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const dryRun = args.has('--dry-run');
const allPackages = args.has('--all');
const bumpArg = getArg('--bump');
const fromRef = getArg('--from');
const changelogPath = getArg('--from-changelog');
const help = args.has('--help') || args.has('-h');

if (help) {
  console.log(`Usage: node scripts/bump-version.mjs [options]

Options:
  --dry-run                 Print planned version bumps without writing files
  --all                     Bump all publishable workspace packages
  --bump <type>             Force bump type: major|minor|patch
  --from <git-ref>          Analyze commits since git ref/tag (default: latest tag, else all commits)
  --from-changelog <path>   Infer bump from changelog headings/content (Added=minor, Fixed=patch, Breaking=major)
  --help                    Show help
`);
  process.exit(0);
}

const BUMP_RANK = { patch: 1, minor: 2, major: 3 };
const VALID_BUMPS = new Set(Object.keys(BUMP_RANK));

function run(cmd, cmdArgs, opts = {}) {
  return execFileSync(cmd, cmdArgs, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  }).trim();
}

function tryRun(cmd, cmdArgs, opts = {}) {
  try {
    return run(cmd, cmdArgs, opts);
  } catch {
    return '';
  }
}

function parseSemver(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-.+)?$/.exec(version);
  if (!m) throw new Error(`Invalid semver: ${version}`);
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function bumpSemver(version, type) {
  const v = parseSemver(version);
  if (type === 'major') return `${v.major + 1}.0.0`;
  if (type === 'minor') return `${v.major}.${v.minor + 1}.0`;
  return `${v.major}.${v.minor}.${v.patch + 1}`;
}

function maxBump(a, b) {
  if (!a) return b;
  if (!b) return a;
  return BUMP_RANK[a] >= BUMP_RANK[b] ? a : b;
}

function bumpFromConventionalCommit(subject, body = '') {
  const text = `${subject}\n${body}`;
  if (/BREAKING CHANGE|^[a-z]+(?:\([^)]+\))?!:/im.test(text)) return 'major';
  if (/^feat(?:\([^)]+\))?:/i.test(subject)) return 'minor';
  if (/^(fix|perf|refactor|build|ci|chore|docs|style|test|revert)(?:\([^)]+\))?:/i.test(subject))
    return 'patch';
  return null;
}

function bumpFromChangelog(content) {
  const lower = content.toLowerCase();
  if (/breaking|major/.test(lower)) return 'major';
  if (/^###?\s+added/m.test(lower) || /\bfeat\b/.test(lower)) return 'minor';
  if (/^###?\s+(fixed|changed|security|deprecated|removed)/m.test(lower) || /\bfix\b/.test(lower))
    return 'patch';
  return null;
}

function getLastTag() {
  return tryRun('git', ['describe', '--tags', '--abbrev=0']);
}

function getCommits(from) {
  const range = from ? `${from}..HEAD` : 'HEAD';
  const raw = tryRun('git', ['log', '--format=%H%x1f%s%x1f%b%x1e', range]);
  if (!raw) return [];
  return raw
    .split('\x1e')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [sha, subject = '', body = ''] = entry.split('\x1f');
      return { sha, subject, body };
    });
}

function getChangedFiles(from) {
  if (!from) {
    const raw = tryRun('git', ['ls-files']);
    return raw ? raw.split('\n').filter(Boolean) : [];
  }
  const raw = tryRun('git', ['diff', '--name-only', `${from}..HEAD`]);
  return raw ? raw.split('\n').filter(Boolean) : [];
}

function walkPackageJsons(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkPackageJsons(full));
    else if (entry.name === 'package.json') out.push(full);
  }
  return out;
}

function loadWorkspacePackages() {
  return walkPackageJsons(path.join(root, 'packages'))
    .map((file) => {
      const json = JSON.parse(readFileSync(file, 'utf8'));
      return { file, dir: path.dirname(file), json };
    })
    .filter((pkg) => pkg.json.name && pkg.json.version && pkg.json.private !== true);
}

function packageForFile(file, packages) {
  const abs = path.resolve(root, file);
  let best = null;
  for (const pkg of packages) {
    if (abs.startsWith(pkg.dir + path.sep) && (!best || pkg.dir.length > best.dir.length))
      best = pkg;
  }
  return best;
}

function resolveBump() {
  if (bumpArg) {
    if (!VALID_BUMPS.has(bumpArg)) throw new Error(`Invalid --bump: ${bumpArg}`);
    return { bump: bumpArg, source: `--bump ${bumpArg}` };
  }
  if (changelogPath) {
    const abs = path.resolve(root, changelogPath);
    if (!existsSync(abs)) throw new Error(`Changelog not found: ${changelogPath}`);
    const bump = bumpFromChangelog(readFileSync(abs, 'utf8'));
    if (!bump) throw new Error(`Could not infer bump from changelog: ${changelogPath}`);
    return { bump, source: `changelog ${changelogPath}` };
  }
  const from = fromRef || getLastTag();
  const commits = getCommits(from);
  if (commits.length === 0) throw new Error(`No commits found since ${from || 'repository start'}`);
  let bump = null;
  for (const commit of commits)
    bump = maxBump(bump, bumpFromConventionalCommit(commit.subject, commit.body));
  if (!bump)
    throw new Error(
      'No conventional commit bump detected (feat/fix/breaking). Use --bump or --from-changelog.',
    );
  return { bump, source: `conventional commits since ${from || 'repository start'}`, from };
}

function resolveTargetPackages(packages, from) {
  if (allPackages) return packages;
  const changedFiles = getChangedFiles(from);
  const targets = new Map();
  for (const file of changedFiles) {
    const pkg = packageForFile(file, packages);
    if (pkg) targets.set(pkg.file, pkg);
  }
  return [...targets.values()];
}

const DEP_SECTIONS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

function updateInternalDeps(pkg, bumpedVersions) {
  let changed = false;
  for (const section of DEP_SECTIONS) {
    const deps = pkg.json[section];
    if (!deps) continue;
    for (const [name, range] of Object.entries(deps)) {
      const nextVersion = bumpedVersions.get(name);
      if (!nextVersion || typeof range !== 'string') continue;
      if (range.startsWith('workspace:')) continue;
      const prefix = range.match(/^[^\d]*/)?.[0] ?? '^';
      const nextRange = `${prefix}${nextVersion}`;
      if (deps[name] !== nextRange) {
        deps[name] = nextRange;
        changed = true;
      }
    }
  }
  return changed;
}

const packages = loadWorkspacePackages();
const { bump, source } = resolveBump();
const effectiveFrom = fromRef || getLastTag();
const targets = resolveTargetPackages(packages, effectiveFrom);

if (targets.length === 0) {
  console.log(`No publishable packages affected (${source}). Use --all to bump all packages.`);
  process.exit(0);
}

const bumpedVersions = new Map();
for (const pkg of targets) {
  bumpedVersions.set(pkg.json.name, bumpSemver(pkg.json.version, bump));
}

console.log(`Bump: ${bump} (${source})`);
console.log(`Targets: ${targets.length}${allPackages ? ' (all)' : ''}`);
for (const pkg of targets) {
  const next = bumpedVersions.get(pkg.json.name);
  console.log(`${dryRun ? '[dry-run] ' : ''}${pkg.json.name}: ${pkg.json.version} -> ${next}`);
  pkg.json.version = next;
}

const depUpdatedFiles = new Set();
for (const pkg of packages) {
  if (updateInternalDeps(pkg, bumpedVersions)) {
    depUpdatedFiles.add(pkg.file);
    console.log(
      `${dryRun ? '[dry-run] ' : ''}${pkg.json.name}: updated internal dependency ranges`,
    );
  }
}

if (!dryRun) {
  for (const pkg of packages) {
    if (bumpedVersions.has(pkg.json.name) || depUpdatedFiles.has(pkg.file)) {
      writeFileSync(pkg.file, JSON.stringify(pkg.json, null, 2) + '\n');
    }
  }
}
console.log(
  `${dryRun ? 'Dry run' : 'Updated'}: ${targets.length} package version(s), ${depUpdatedFiles.size} package(s) with internal dep range updates.`,
);
