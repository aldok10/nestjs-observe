// Architecture and naming checker for the nestjs-observe workspace packages.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importViolation, matchesPrefix, packageNameOf } from './architecture-rules.mjs';

const rootArg = process.argv.indexOf('--root');
const root =
  rootArg === -1
    ? join(dirname(fileURLToPath(import.meta.url)), '..')
    : resolve(process.argv[rootArg + 1] ?? '.');
const packagesDir = join(root, 'packages');

const BACKENDS = ['pino', 'winston', 'bunyan', 'log4js'];
const HTTP_FRAMEWORKS = ['express', 'fastify'];
const LOGGER_NS = '@aldok10/nestjs-observe-logger';
const TRACING_NS = '@aldok10/nestjs-observe-tracing';
const METRICS_NS = '@aldok10/nestjs-observe-metrics';
const ERROR_TRACKING_NS = '@aldok10/nestjs-observe-error-tracking';
const OBSERVER_MAIN = '@aldok10/nestjs-observe';
const OBSERVER_TESTING = '@aldok10/nestjs-observe-testing';
const SHARED_CORE = '@aldok10/nestjs-observe-core';

const LOGGER_ADAPTERS = [
  `${LOGGER_NS}-adapter-pino`,
  `${LOGGER_NS}-adapter-winston`,
  `${LOGGER_NS}-adapter-bunyan`,
  `${LOGGER_NS}-adapter-log4js`,
  `${LOGGER_NS}-http`,
];

const ERROR_TRACKING_ADAPTERS = [
  `${ERROR_TRACKING_NS}-sentry`,
  `${ERROR_TRACKING_NS}-glitchtip`,
  `${ERROR_TRACKING_NS}-bugsink`,
  `${ERROR_TRACKING_NS}-highlight`,
  `${ERROR_TRACKING_NS}-bugsnag`,
  `${ERROR_TRACKING_NS}-rollbar`,
  `${ERROR_TRACKING_NS}-honeybadger`,
  `${ERROR_TRACKING_NS}-otlp`,
  `${ERROR_TRACKING_NS}-new-relic`,
  `${ERROR_TRACKING_NS}-datadog`,
  `${ERROR_TRACKING_NS}-dynatrace`,
  `${ERROR_TRACKING_NS}-elastic-apm`,
  `${ERROR_TRACKING_NS}-splunk`,
  `${ERROR_TRACKING_NS}-appdynamics`,
  `${ERROR_TRACKING_NS}-airbrake`,
  `${ERROR_TRACKING_NS}-raygun`,
];

const CROSS_DOMAIN_FOR_LOGGER = [
  TRACING_NS,
  METRICS_NS,
  ERROR_TRACKING_NS,
  OBSERVER_MAIN,
  OBSERVER_TESTING,
];
const CROSS_DOMAIN_FOR_TRACING = [
  LOGGER_NS,
  METRICS_NS,
  ERROR_TRACKING_NS,
  OBSERVER_MAIN,
  OBSERVER_TESTING,
];
const CROSS_DOMAIN_FOR_METRICS = [
  LOGGER_NS,
  TRACING_NS,
  ERROR_TRACKING_NS,
  OBSERVER_MAIN,
  OBSERVER_TESTING,
];
const CROSS_DOMAIN_FOR_ERROR_TRACKING = [
  LOGGER_NS,
  TRACING_NS,
  METRICS_NS,
  OBSERVER_MAIN,
  OBSERVER_TESTING,
];

const LOGGER_CORE_ONLY_FORBIDDEN = [
  '@nestjs/',
  ...BACKENDS,
  ...HTTP_FRAMEWORKS,
  ...LOGGER_ADAPTERS,
  LOGGER_NS,
  `${LOGGER_NS}-testing`,
  ...CROSS_DOMAIN_FOR_LOGGER,
];

const FORBIDDEN = {
  [SHARED_CORE]: ['@nestjs/', '@opentelemetry/', '@aldok10/', ...BACKENDS, ...HTTP_FRAMEWORKS],
  [`${LOGGER_NS}-core`]: [
    '@nestjs/',
    '@opentelemetry/',
    ...BACKENDS,
    ...HTTP_FRAMEWORKS,
    ...LOGGER_ADAPTERS,
    LOGGER_NS,
    `${LOGGER_NS}-testing`,
    ...CROSS_DOMAIN_FOR_LOGGER,
  ],
  [LOGGER_NS]: [
    ...BACKENDS,
    ...HTTP_FRAMEWORKS,
    ...LOGGER_ADAPTERS,
    `${LOGGER_NS}-testing`,
    ...CROSS_DOMAIN_FOR_LOGGER,
  ],
  [`${LOGGER_NS}-adapter-pino`]: [
    '@nestjs/',
    'winston',
    'bunyan',
    'log4js',
    LOGGER_NS,
    `${LOGGER_NS}-testing`,
    ...CROSS_DOMAIN_FOR_LOGGER,
  ],
  [`${LOGGER_NS}-adapter-winston`]: [
    '@nestjs/',
    'pino',
    'bunyan',
    'log4js',
    LOGGER_NS,
    `${LOGGER_NS}-testing`,
    ...CROSS_DOMAIN_FOR_LOGGER,
  ],
  [`${LOGGER_NS}-adapter-bunyan`]: [
    '@nestjs/',
    'pino',
    'winston',
    'log4js',
    LOGGER_NS,
    `${LOGGER_NS}-testing`,
    ...CROSS_DOMAIN_FOR_LOGGER,
  ],
  [`${LOGGER_NS}-adapter-log4js`]: [
    '@nestjs/',
    'pino',
    'winston',
    'bunyan',
    LOGGER_NS,
    `${LOGGER_NS}-testing`,
    ...CROSS_DOMAIN_FOR_LOGGER,
  ],
  [`${LOGGER_NS}-http`]: [
    ...BACKENDS,
    LOGGER_NS,
    `${LOGGER_NS}-testing`,
    ...CROSS_DOMAIN_FOR_LOGGER,
  ],
  [`${LOGGER_NS}-delivery`]: LOGGER_CORE_ONLY_FORBIDDEN,
  [`${LOGGER_NS}-context`]: LOGGER_CORE_ONLY_FORBIDDEN,
  [`${LOGGER_NS}-filtering`]: LOGGER_CORE_ONLY_FORBIDDEN,
  [`${LOGGER_NS}-formatters`]: LOGGER_CORE_ONLY_FORBIDDEN,
  [`${LOGGER_NS}-redaction`]: LOGGER_CORE_ONLY_FORBIDDEN,
  [`${LOGGER_NS}-transports`]: LOGGER_CORE_ONLY_FORBIDDEN,
  [`${LOGGER_NS}-testing`]: LOGGER_CORE_ONLY_FORBIDDEN,
  [TRACING_NS]: CROSS_DOMAIN_FOR_TRACING,
  [`${TRACING_NS}-exporter-otlp`]: CROSS_DOMAIN_FOR_TRACING,
  [`${TRACING_NS}-exporter-console`]: CROSS_DOMAIN_FOR_TRACING,
  [`${TRACING_NS}-instrumentation-http`]: CROSS_DOMAIN_FOR_TRACING,
  [`${TRACING_NS}-instrumentation-data`]: CROSS_DOMAIN_FOR_TRACING,
  [`${TRACING_NS}-testing`]: CROSS_DOMAIN_FOR_TRACING,
  [METRICS_NS]: CROSS_DOMAIN_FOR_METRICS,
  [`${METRICS_NS}-exporter-prometheus`]: CROSS_DOMAIN_FOR_METRICS,
  [`${METRICS_NS}-exporter-otlp`]: CROSS_DOMAIN_FOR_METRICS,
  [`${METRICS_NS}-exporter-console`]: CROSS_DOMAIN_FOR_METRICS,
  [`${METRICS_NS}-instrumentation`]: CROSS_DOMAIN_FOR_METRICS,
  [`${METRICS_NS}-testing`]: CROSS_DOMAIN_FOR_METRICS,
  [ERROR_TRACKING_NS]: [
    ...CROSS_DOMAIN_FOR_ERROR_TRACKING,
    ...ERROR_TRACKING_ADAPTERS,
    `${ERROR_TRACKING_NS}-testing`,
  ],
  [`${ERROR_TRACKING_NS}-sentry`]: [
    ...CROSS_DOMAIN_FOR_ERROR_TRACKING,
    ...ERROR_TRACKING_ADAPTERS.filter((a) => a !== `${ERROR_TRACKING_NS}-sentry`),
    '@bugsnag/js',
    'rollbar',
    '@honeybadger-io/js',
    '@highlight-run/node',
  ],
  [`${ERROR_TRACKING_NS}-glitchtip`]: [
    ...CROSS_DOMAIN_FOR_ERROR_TRACKING,
    ...ERROR_TRACKING_ADAPTERS.filter((a) => a !== `${ERROR_TRACKING_NS}-glitchtip`),
    '@bugsnag/js',
    'rollbar',
    '@honeybadger-io/js',
    '@highlight-run/node',
  ],
  [`${ERROR_TRACKING_NS}-bugsink`]: [
    ...CROSS_DOMAIN_FOR_ERROR_TRACKING,
    ...ERROR_TRACKING_ADAPTERS.filter((a) => a !== `${ERROR_TRACKING_NS}-bugsink`),
    '@bugsnag/js',
    'rollbar',
    '@honeybadger-io/js',
    '@highlight-run/node',
  ],
  [`${ERROR_TRACKING_NS}-highlight`]: [
    ...CROSS_DOMAIN_FOR_ERROR_TRACKING,
    ...ERROR_TRACKING_ADAPTERS.filter((a) => a !== `${ERROR_TRACKING_NS}-highlight`),
    '@sentry/node',
    '@bugsnag/js',
    'rollbar',
    '@honeybadger-io/js',
  ],
  [`${ERROR_TRACKING_NS}-bugsnag`]: [
    ...CROSS_DOMAIN_FOR_ERROR_TRACKING,
    ...ERROR_TRACKING_ADAPTERS.filter((a) => a !== `${ERROR_TRACKING_NS}-bugsnag`),
    '@sentry/node',
    'rollbar',
    '@honeybadger-io/js',
    '@highlight-run/node',
  ],
  [`${ERROR_TRACKING_NS}-rollbar`]: [
    ...CROSS_DOMAIN_FOR_ERROR_TRACKING,
    ...ERROR_TRACKING_ADAPTERS.filter((a) => a !== `${ERROR_TRACKING_NS}-rollbar`),
    '@sentry/node',
    '@bugsnag/js',
    '@honeybadger-io/js',
    '@highlight-run/node',
  ],
  [`${ERROR_TRACKING_NS}-honeybadger`]: [
    ...CROSS_DOMAIN_FOR_ERROR_TRACKING,
    ...ERROR_TRACKING_ADAPTERS.filter((a) => a !== `${ERROR_TRACKING_NS}-honeybadger`),
    '@sentry/node',
    '@bugsnag/js',
    'rollbar',
    '@highlight-run/node',
  ],
  [`${ERROR_TRACKING_NS}-otlp`]: [
    ...CROSS_DOMAIN_FOR_ERROR_TRACKING,
    ...ERROR_TRACKING_ADAPTERS.filter((a) => a !== `${ERROR_TRACKING_NS}-otlp`),
    '@sentry/node',
    '@bugsnag/js',
    'rollbar',
    '@honeybadger-io/js',
    '@highlight-run/node',
    'newrelic',
    'dd-trace',
    'elastic-apm-node',
    'appdynamics',
    '@airbrake/node',
    'raygun',
  ],
  [`${ERROR_TRACKING_NS}-new-relic`]: [
    ...CROSS_DOMAIN_FOR_ERROR_TRACKING,
    ...ERROR_TRACKING_ADAPTERS.filter((a) => a !== `${ERROR_TRACKING_NS}-new-relic`),
    '@sentry/node',
    '@bugsnag/js',
    'rollbar',
    '@honeybadger-io/js',
    '@highlight-run/node',
    'dd-trace',
    'elastic-apm-node',
    'appdynamics',
    '@airbrake/node',
    'raygun',
  ],
  [`${ERROR_TRACKING_NS}-datadog`]: [
    ...CROSS_DOMAIN_FOR_ERROR_TRACKING,
    ...ERROR_TRACKING_ADAPTERS.filter((a) => a !== `${ERROR_TRACKING_NS}-datadog`),
    '@sentry/node',
    '@bugsnag/js',
    'rollbar',
    '@honeybadger-io/js',
    '@highlight-run/node',
    'newrelic',
    'elastic-apm-node',
    'appdynamics',
    '@airbrake/node',
    'raygun',
  ],
  [`${ERROR_TRACKING_NS}-dynatrace`]: [
    ...CROSS_DOMAIN_FOR_ERROR_TRACKING,
    ...ERROR_TRACKING_ADAPTERS.filter((a) => a !== `${ERROR_TRACKING_NS}-dynatrace`),
    '@sentry/node',
    '@bugsnag/js',
    'rollbar',
    '@honeybadger-io/js',
    '@highlight-run/node',
    'newrelic',
    'dd-trace',
    'elastic-apm-node',
    'appdynamics',
    '@airbrake/node',
    'raygun',
  ],
  [`${ERROR_TRACKING_NS}-elastic-apm`]: [
    ...CROSS_DOMAIN_FOR_ERROR_TRACKING,
    ...ERROR_TRACKING_ADAPTERS.filter((a) => a !== `${ERROR_TRACKING_NS}-elastic-apm`),
    '@sentry/node',
    '@bugsnag/js',
    'rollbar',
    '@honeybadger-io/js',
    '@highlight-run/node',
    'newrelic',
    'dd-trace',
    'appdynamics',
    '@airbrake/node',
    'raygun',
  ],
  [`${ERROR_TRACKING_NS}-splunk`]: [
    ...CROSS_DOMAIN_FOR_ERROR_TRACKING,
    ...ERROR_TRACKING_ADAPTERS.filter((a) => a !== `${ERROR_TRACKING_NS}-splunk`),
    '@sentry/node',
    '@bugsnag/js',
    'rollbar',
    '@honeybadger-io/js',
    '@highlight-run/node',
    'newrelic',
    'dd-trace',
    'elastic-apm-node',
    'appdynamics',
    '@airbrake/node',
    'raygun',
  ],
  [`${ERROR_TRACKING_NS}-appdynamics`]: [
    ...CROSS_DOMAIN_FOR_ERROR_TRACKING,
    ...ERROR_TRACKING_ADAPTERS.filter((a) => a !== `${ERROR_TRACKING_NS}-appdynamics`),
    '@sentry/node',
    '@bugsnag/js',
    'rollbar',
    '@honeybadger-io/js',
    '@highlight-run/node',
    'newrelic',
    'dd-trace',
    'elastic-apm-node',
    '@airbrake/node',
    'raygun',
  ],
  [`${ERROR_TRACKING_NS}-airbrake`]: [
    ...CROSS_DOMAIN_FOR_ERROR_TRACKING,
    ...ERROR_TRACKING_ADAPTERS.filter((a) => a !== `${ERROR_TRACKING_NS}-airbrake`),
    '@sentry/node',
    '@bugsnag/js',
    'rollbar',
    '@honeybadger-io/js',
    '@highlight-run/node',
    'newrelic',
    'dd-trace',
    'elastic-apm-node',
    'appdynamics',
    'raygun',
  ],
  [`${ERROR_TRACKING_NS}-raygun`]: [
    ...CROSS_DOMAIN_FOR_ERROR_TRACKING,
    ...ERROR_TRACKING_ADAPTERS.filter((a) => a !== `${ERROR_TRACKING_NS}-raygun`),
    '@sentry/node',
    '@bugsnag/js',
    'rollbar',
    '@honeybadger-io/js',
    '@highlight-run/node',
    'newrelic',
    'dd-trace',
    'elastic-apm-node',
    'appdynamics',
    '@airbrake/node',
  ],
  [`${ERROR_TRACKING_NS}-testing`]: CROSS_DOMAIN_FOR_ERROR_TRACKING,
  [OBSERVER_MAIN]: [OBSERVER_TESTING],
  [OBSERVER_TESTING]: [],
};

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PASCAL_CASE = /^[A-Z][a-zA-Z0-9]*$/;
const I_PREFIX = /^I[A-Z]/;
const DECL_RE =
  /^export\s+(?:declare\s+)?(?:abstract\s+)?(class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;
const IMPORT_RE =
  /(?:^|[\s;])(import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const builtins = new Set(builtinModules);

const errors = [];
const fail = (what, why, fix) => errors.push({ what, why, fix });

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!KEBAB.test(entry)) {
        fail(
          `Directory is not kebab-case: ${relative(root, full)}`,
          'Package/source directory names must be kebab-case.',
          `Rename "${entry}" to kebab-case.`,
        );
      }
      walk(full, out);
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

function discoverPackages(baseDir) {
  const discovered = [];
  const scanDir = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'dist' || entry === 'src') continue;
      const full = join(dir, entry);
      if (!statSync(full).isDirectory()) continue;
      if (existsSync(join(full, 'package.json'))) {
        discovered.push({ dir: full, dirName: entry });
      } else {
        scanDir(full);
      }
    }
  };
  scanDir(baseDir);
  return discovered.map(({ dir, dirName }) => {
    if (!KEBAB.test(dirName)) {
      fail(
        `Package directory is not kebab-case: ${relative(root, dir)}`,
        'Workspace package directories must use kebab-case.',
        `Rename ${dirName} to kebab-case.`,
      );
    }
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return { dir, manifest, name: manifest.name };
  });
}

const packages = discoverPackages(packagesDir);
const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));

const optionalPeerNames = new Set(
  packages.flatMap((pkg) =>
    Object.entries(pkg.manifest.peerDependenciesMeta ?? {})
      .filter(([, meta]) => meta?.optional === true)
      .map(([dep]) => dep)
      .filter((dep) => dep in (pkg.manifest.peerDependencies ?? {})),
  ),
);
const optionalPeersByPkg = new Map(
  packages.map((pkg) => {
    const required = new Set([
      ...Object.keys(pkg.manifest.dependencies ?? {}),
      ...Object.keys(pkg.manifest.peerDependencies ?? {}).filter(
        (dep) => pkg.manifest.peerDependenciesMeta?.[dep]?.optional !== true,
      ),
    ]);
    return [
      pkg.name,
      new Set([...optionalPeerNames].filter((dep) => !required.has(dep) && dep !== pkg.name)),
    ];
  }),
);

for (const pkg of packages) {
  const { manifest } = pkg;
  if (!(pkg.name in FORBIDDEN)) {
    fail(
      `${pkg.name}: no boundary rules defined`,
      'Every workspace package must have explicit dependency/import boundaries.',
      `Add ${pkg.name} to FORBIDDEN in scripts/check-architecture.mjs.`,
    );
  }

  for (const field of [
    'dependencies',
    'peerDependencies',
    'optionalDependencies',
    'devDependencies',
  ]) {
    for (const [dep, range] of Object.entries(manifest[field] ?? {})) {
      if (String(range).startsWith('workspace:')) {
        fail(
          `${pkg.name}: ${field}.${dep} uses "${range}"`,
          'Publishable package manifests must not use workspace:* protocol.',
          `Replace "${range}" with "^0.1.1" for ${dep}.`,
        );
      }
      if (dep === pkg.name) {
        fail(
          `${pkg.name}: depends on itself in ${field}`,
          'A package cannot depend on itself.',
          `Remove ${dep} from ${field}.`,
        );
      }
    }
  }

  if (manifest.private === true) {
    fail(
      `${pkg.name}: private is true`,
      'Workspace packages must be publishable.',
      'Remove private: true.',
    );
  }
  if (manifest.publishConfig?.access !== 'public') {
    fail(
      `${pkg.name}: publishConfig.access is not "public"`,
      'Scoped packages require public access.',
      'Set publishConfig.access = "public".',
    );
  }
  if (manifest.exports?.['.'] === undefined) {
    fail(
      `${pkg.name}: missing exports["."]`,
      'Packages must define root export.',
      'Add exports["."].',
    );
  }
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  if (!(
    (files.length === 1 && files[0] === 'dist') ||
    (files.length === 2 && files.includes('dist') && files.includes('LICENSE'))
  )) {
    fail(
      `${pkg.name}: files must be ["dist"] or ["LICENSE","dist"]`,
      'Published contents must be minimal.',
      'Set files to ["LICENSE","dist"].',
    );
  }

  for (const forbidden of FORBIDDEN[pkg.name] ?? []) {
    for (const dep of Object.keys(manifest.dependencies ?? {})) {
      if (matchesPrefix(dep, forbidden)) {
        fail(
          `${pkg.name}: forbidden runtime dependency "${dep}"`,
          'Package dependency boundaries forbid this runtime dependency.',
          `Remove "${dep}" from dependencies.`,
        );
      }
    }
  }
}

const edges = new Map(packages.map((pkg) => [pkg.name, new Set()]));
for (const pkg of packages) {
  const declared = new Set([
    ...Object.keys(pkg.manifest.dependencies ?? {}),
    ...Object.keys(pkg.manifest.peerDependencies ?? {}),
    ...Object.keys(pkg.manifest.optionalDependencies ?? {}),
  ]);
  for (const file of walk(join(pkg.dir, 'src'))) {
    const isSpec = file.endsWith('.spec.ts');
    const rel = relative(root, file);
    const source = readFileSync(file, 'utf8');

    if (!isSpec) {
      for (const [, kind, name] of source.matchAll(DECL_RE)) {
        if (!PASCAL_CASE.test(name)) {
          fail(
            `${rel}: exported ${kind} "${name}" must be PascalCase`,
            'Exported types must be PascalCase.',
            `Rename ${name}.`,
          );
        }
        if (kind === 'interface' && I_PREFIX.test(name)) {
          fail(
            `${rel}: interface "${name}" must not use an "I" prefix`,
            'Avoid Hungarian I-prefix.',
            `Rename ${name}.`,
          );
        }
      }
    }

    for (const match of source.matchAll(IMPORT_RE)) {
      const isTypeOnly = match[2] !== undefined;
      const isDynamic = match[4] !== undefined;
      const specifier = match[3] ?? match[4];
      if (specifier.startsWith('.')) {
        const target = resolve(dirname(file), specifier);
        if (!target.startsWith(pkg.dir + sep)) {
          fail(
            `${rel}: relative import escapes its package: "${specifier}"`,
            'No cross-package relative imports.',
            'Use package import.',
          );
        }
        continue;
      }
      if (specifier.startsWith('node:') || builtins.has(specifier)) continue;

      const depName = packageNameOf(specifier);
      const sibling = byName.get(depName);
      if (sibling !== undefined && sibling !== pkg) {
        const subpath = specifier === depName ? '.' : `.${specifier.slice(depName.length)}`;
        if (sibling.manifest.exports?.[subpath] === undefined) {
          fail(
            `${rel}: "${specifier}" is not an exported entry point of ${depName}`,
            'Use public exports only.',
            `Export "${subpath}".`,
          );
        }
      }

      const violation = importViolation({
        pkg: pkg.name,
        specifier,
        isSpec,
        isTypeOnly,
        isDynamic,
        forbiddenPrefixes: FORBIDDEN[pkg.name] ?? [],
        declared,
        optionalPeers: optionalPeersByPkg.get(pkg.name) ?? new Set(),
      });
      if (violation !== null) {
        fail(
          `${rel}: ${violation}`,
          'Respect domain isolation, manifest declarations, and lazy optional peers.',
          `Fix "${specifier}".`,
        );
      }
      if (!isSpec && sibling !== undefined && sibling !== pkg) edges.get(pkg.name).add(depName);
    }
  }
}

for (const pkg of packages) {
  for (const dep of Object.keys(pkg.manifest.dependencies ?? {})) {
    if (byName.has(dep)) edges.get(pkg.name).add(dep);
  }
}

const state = new Map();
function visit(name, stack) {
  state.set(name, 'visiting');
  for (const next of edges.get(name) ?? []) {
    if (state.get(next) === 'visiting') {
      fail(
        `Package cycle: ${[...stack, name, next].join(' -> ')}`,
        'Circular dependencies are forbidden.',
        'Break the cycle.',
      );
    } else if (!state.has(next)) visit(next, [...stack, name]);
  }
  state.set(name, 'done');
}
for (const name of edges.keys()) if (!state.has(name)) visit(name, []);

if (errors.length > 0) {
  console.error(
    `ARCHITECTURE CHECK FAILED (${errors.length} violation${errors.length === 1 ? '' : 's'})\n`,
  );
  for (const [i, e] of errors.entries()) {
    console.error(`Violation ${i + 1}\nWHAT: ${e.what}\nWHY: ${e.why}\nFIX: ${e.fix}\n`);
  }
  process.exit(1);
}

console.log(`architecture check passed for ${packages.length} packages`);
for (const [name, deps] of edges) {
  console.log(`  ${name} -> ${deps.size === 0 ? '(none)' : [...deps].join(', ')}`);
}
