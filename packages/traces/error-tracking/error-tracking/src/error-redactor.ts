import type {
  ErrorBreadcrumb,
  ErrorCauseInfo,
  ErrorRedactionOptions,
  ObserveErrorEvent,
} from './error-tracking.contracts.js';

const DEFAULT_DENYLIST_KEYS = [
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'apikey',
  'api_key',
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'privatekey',
  'private_key',
  'connectionstring',
  'connection_string',
  'dsn',
  'credential',
  'credentials',
  'ssn',
  'creditcard',
  'credit_card',
  'x-api-key',
  'x-auth-token',
];

const DEFAULT_REPLACEMENT = '[REDACTED]';
const DEFAULT_MAX_DEPTH = 6;
const DEFAULT_MAX_STRING_LENGTH = 2048;

const CREDENTIAL_URL_RE = /([a-z][a-z0-9+.-]*:\/\/)([^:@/\s]+):([^@/\s]+)@/gi;
const BEARER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/]+=*/gi;

interface RedactConfig {
  readonly replacement: string;
  readonly denylist: ReadonlySet<string>;
  readonly allowlist: ReadonlySet<string>;
  readonly maxDepth: number;
  readonly maxStringLength: number;
}

function buildConfig(options: ErrorRedactionOptions = {}): RedactConfig {
  const denylist = new Set<string>(DEFAULT_DENYLIST_KEYS.map((k) => k.toLowerCase()));
  for (const key of options.denylistKeys ?? []) denylist.add(key.toLowerCase());
  const allowlist = new Set<string>((options.allowlistKeys ?? []).map((k) => k.toLowerCase()));
  return {
    replacement: options.replacement ?? DEFAULT_REPLACEMENT,
    denylist,
    allowlist,
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
    maxStringLength: options.maxStringLength ?? DEFAULT_MAX_STRING_LENGTH,
  };
}

function isSensitiveKey(key: string, config: RedactConfig): boolean {
  const normalized = key.toLowerCase();
  if (config.allowlist.has(normalized)) return false;
  if (config.denylist.has(normalized)) return true;
  for (const pattern of config.denylist) {
    if (normalized.includes(pattern)) return true;
  }
  return false;
}

export function sanitizeString(value: string, config: RedactConfig): string {
  const masked = value
    .replace(CREDENTIAL_URL_RE, `$1${config.replacement}@`)
    .replace(BEARER_RE, `$1 ${config.replacement}`);
  if (masked.length <= config.maxStringLength) return masked;
  return `${masked.slice(0, config.maxStringLength)}...[TRUNCATED]`;
}

function sanitizeValue(
  value: unknown,
  config: RedactConfig,
  seen: WeakSet<object>,
  depth: number,
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return sanitizeString(value, config);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value;
  if (typeof value === 'symbol' || typeof value === 'function') return value.toString();
  if (typeof value !== 'object') return value;

  if (seen.has(value)) return '[Circular]';
  if (depth >= config.maxDepth) return '[MaxDepth]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, config, seen, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isSensitiveKey(key, config)) {
      out[key] = config.replacement;
    } else {
      out[key] = sanitizeValue(entry, config, seen, depth + 1);
    }
  }
  return out;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)
  );
}

function sanitizeRecord(
  record: Readonly<Record<string, unknown>> | undefined,
  config: RedactConfig,
): Record<string, unknown> | undefined {
  if (record === undefined) return undefined;
  const sanitized = sanitizeValue(record, config, new WeakSet<object>(), 0);
  return isPlainRecord(sanitized) ? sanitized : undefined;
}

function sanitizeStringRecord(
  record: Readonly<Record<string, string>> | undefined,
  config: RedactConfig,
): Record<string, string> | undefined {
  if (record === undefined) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = isSensitiveKey(key, config) ? config.replacement : sanitizeString(value, config);
  }
  return out;
}

function sanitizeCauses(
  causes: readonly ErrorCauseInfo[] | undefined,
  config: RedactConfig,
): readonly ErrorCauseInfo[] | undefined {
  if (causes === undefined) return undefined;
  return causes.map((cause) => ({
    ...cause,
    message: sanitizeString(cause.message, config),
    ...(cause.stack !== undefined ? { stack: sanitizeString(cause.stack, config) } : {}),
  }));
}

function sanitizeBreadcrumbs(
  breadcrumbs: readonly ErrorBreadcrumb[] | undefined,
  config: RedactConfig,
): readonly ErrorBreadcrumb[] | undefined {
  if (breadcrumbs === undefined) return undefined;
  return breadcrumbs.map((crumb) => {
    const data = sanitizeRecord(crumb.data, config);
    return {
      ...crumb,
      message: sanitizeString(crumb.message, config),
      ...(data !== undefined ? { data } : {}),
    };
  });
}

export function redactErrorEvent(
  event: ObserveErrorEvent,
  options: ErrorRedactionOptions = {},
): ObserveErrorEvent {
  if (options.enabled === false) return event;
  const config = buildConfig(options);

  const sanitizedHeaders = sanitizeRecord(event.request?.headers, config);
  const sanitizedQuery = sanitizeRecord(event.request?.query, config);
  const sanitizedBody =
    event.request?.body !== undefined
      ? sanitizeValue(event.request.body, config, new WeakSet<object>(), 0)
      : undefined;
  const sanitizedUrl =
    event.request?.url !== undefined ? sanitizeString(event.request.url, config) : undefined;

  const sanitizedRequest =
    event.request !== undefined
      ? {
          ...event.request,
          ...(sanitizedUrl !== undefined ? { url: sanitizedUrl } : {}),
          ...(sanitizedHeaders !== undefined ? { headers: sanitizedHeaders } : {}),
          ...(sanitizedQuery !== undefined ? { query: sanitizedQuery } : {}),
          ...(sanitizedBody !== undefined ? { body: sanitizedBody } : {}),
        }
      : undefined;

  const sanitizedJobData = sanitizeRecord(event.job?.data, config);
  const sanitizedJob =
    event.job !== undefined
      ? {
          ...event.job,
          ...(sanitizedJobData !== undefined ? { data: sanitizedJobData } : {}),
        }
      : undefined;

  const sanitizedDatabase =
    event.database !== undefined
      ? {
          ...event.database,
          ...(event.database.querySummary !== undefined
            ? { querySummary: sanitizeString(event.database.querySummary, config) }
            : {}),
        }
      : undefined;

  const sanitizedAttributes = sanitizeRecord(event.attributes, config);
  const sanitizedVendorContext = sanitizeRecord(event.vendorContext, config);
  const sanitizedTags = sanitizeStringRecord(event.tags, config);
  const sanitizedCauses = sanitizeCauses(event.causes, config);
  const sanitizedAggregate = sanitizeCauses(event.aggregateErrors, config);
  const sanitizedBreadcrumbs = sanitizeBreadcrumbs(event.breadcrumbs, config);

  const stack =
    options.stripStackFrames === true
      ? undefined
      : event.stack !== undefined
        ? sanitizeString(event.stack, config)
        : undefined;

  return {
    ...event,
    message: sanitizeString(event.message, config),
    ...(stack !== undefined ? { stack } : {}),
    ...(sanitizedCauses !== undefined ? { causes: sanitizedCauses } : {}),
    ...(sanitizedAggregate !== undefined ? { aggregateErrors: sanitizedAggregate } : {}),
    ...(sanitizedRequest !== undefined ? { request: sanitizedRequest } : {}),
    ...(sanitizedJob !== undefined ? { job: sanitizedJob } : {}),
    ...(sanitizedDatabase !== undefined ? { database: sanitizedDatabase } : {}),
    ...(sanitizedAttributes !== undefined ? { attributes: sanitizedAttributes } : {}),
    ...(sanitizedVendorContext !== undefined ? { vendorContext: sanitizedVendorContext } : {}),
    ...(sanitizedTags !== undefined ? { tags: sanitizedTags } : {}),
    ...(sanitizedBreadcrumbs !== undefined ? { breadcrumbs: sanitizedBreadcrumbs } : {}),
  };
}
