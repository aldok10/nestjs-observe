// Pure dependency-direction predicates shared by the architecture checker and its tests.
const LOGGER_NS = '@aldok10/nestjs-observe-logger';
const TRACING_NS = '@aldok10/nestjs-observe-tracing';
const METRICS_NS = '@aldok10/nestjs-observe-metrics';

export const BACKEND_ADAPTERS = new Set([
  `${LOGGER_NS}-adapter-pino`,
  `${LOGGER_NS}-adapter-winston`,
  `${LOGGER_NS}-adapter-bunyan`,
  `${LOGGER_NS}-adapter-log4js`,
]);

export const TRANSPORT_PACKAGES = new Set([`${LOGGER_NS}-transports`]);

export const INTEGRATION_PACKAGES = new Set([
  LOGGER_NS,
  `${LOGGER_NS}-http`,
  `${LOGGER_NS}-sentry`,
  `${LOGGER_NS}-context`,
]);

export const OPTIONAL_PEER_OWNERS = {
  '@opentelemetry/api': `${LOGGER_NS}-context`,
  'rotating-file-stream': `${LOGGER_NS}-transports`,
  '@sentry/node': `${LOGGER_NS}-sentry`,
  express: `${LOGGER_NS}-http`,
  fastify: `${LOGGER_NS}-http`,
  '@nestjs/common': `${LOGGER_NS}-http`,
  rxjs: `${LOGGER_NS}-http`,
  '@aldok10/nestjs-observe-logger': '@aldok10/nestjs-observe',
  '@aldok10/nestjs-observe-tracing': '@aldok10/nestjs-observe',
  '@aldok10/nestjs-observe-metrics': '@aldok10/nestjs-observe',
};

export const TEST_IMPORT_ALLOWANCE = {
  [LOGGER_NS]: new Set([
    'pino',
    'winston',
    `${LOGGER_NS}-adapter-pino`,
    `${LOGGER_NS}-adapter-winston`,
    `${LOGGER_NS}-testing`,
  ]),
  [`${LOGGER_NS}-http`]: new Set(['express', 'fastify']),
  [`${LOGGER_NS}-adapter-pino`]: new Set(['pino']),
  [`${LOGGER_NS}-adapter-winston`]: new Set(['winston']),
  [`${LOGGER_NS}-adapter-bunyan`]: new Set(['bunyan']),
  [`${LOGGER_NS}-adapter-log4js`]: new Set(['log4js']),
  [`${METRICS_NS}-exporter-prometheus`]: new Set([METRICS_NS]),
  '@aldok10/nestjs-observe': new Set([LOGGER_NS, TRACING_NS, METRICS_NS, `${LOGGER_NS}-testing`]),
};

export function packageNameOf(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

export function matchesPrefix(specifier, prefix) {
  if (prefix.endsWith('/')) return specifier.startsWith(prefix);
  return specifier === prefix || specifier.startsWith(`${prefix}/`);
}

export function roleForbiddenEdge(from, to) {
  if (BACKEND_ADAPTERS.has(from) && TRANSPORT_PACKAGES.has(to)) {
    return 'backend-adapter-to-destination-transport';
  }
  if (TRANSPORT_PACKAGES.has(from) && TRANSPORT_PACKAGES.has(to)) {
    return 'transport-to-transport';
  }
  if (INTEGRATION_PACKAGES.has(from) && INTEGRATION_PACKAGES.has(to) && from !== to) {
    return 'integration-to-unrelated-integration';
  }
  return null;
}

export function importViolation({
  pkg,
  specifier,
  isSpec = false,
  isTypeOnly = false,
  isDynamic = false,
  forbiddenPrefixes = [],
  declared = new Set(),
  optionalPeers = new Set(),
}) {
  const dep = packageNameOf(specifier);
  const fixtureAllowed = isSpec && TEST_IMPORT_ALLOWANCE[pkg]?.has(dep) === true;

  if (!isSpec && optionalPeers.has(dep) && !isTypeOnly && !isDynamic) {
    return `optional peer "${dep}" must be type-only or loaded lazily (owner: ${
      OPTIONAL_PEER_OWNERS[dep] ?? 'unknown'
    })`;
  }

  for (const prefix of forbiddenPrefixes) {
    if (matchesPrefix(specifier, prefix) && !fixtureAllowed) {
      return `forbidden import "${specifier}"`;
    }
  }

  const edge = roleForbiddenEdge(pkg, dep);
  if (edge !== null && !fixtureAllowed) {
    return `${edge}: "${dep}" is not an allowed dependency of ${pkg}`;
  }

  if (!isSpec && !declared.has(dep)) return `undeclared dependency "${dep}"`;
  return null;
}
