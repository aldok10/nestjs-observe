import type { RedactionMatcher } from '@aldok10/nestjs-observe-logger-core/contracts';

export interface FieldRedactionOptions {
  /** Leaf key names to mask (substring match, case-insensitive). */
  readonly fields: readonly string[];
  /** `deny` masks listed keys; `allow` masks every key except listed ones. */
  readonly mode?: 'deny' | 'allow';
}

export function fieldRedactor(options: FieldRedactionOptions): RedactionMatcher {
  const fields = options.fields.map((field) => field.toLowerCase()).filter(Boolean);
  const allow = options.mode === 'allow';
  return (key) => {
    if (key === '') return false;
    const lower = key.toLowerCase();
    const listed = fields.some((field) => lower.includes(field));
    return allow ? !listed : listed;
  };
}

function withoutStatefulFlags(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ''));
}

/** Masks keys or string values matching any of the supplied patterns. */
export function regexRedactor(patterns: readonly RegExp[]): RedactionMatcher {
  const normalized = patterns.map(withoutStatefulFlags);
  return (key, value) => {
    if (normalized.some((pattern) => pattern.test(key))) return true;
    return typeof value === 'string' && normalized.some((pattern) => pattern.test(value));
  };
}

export interface HeaderRedactionOptions {
  /** Header names that may pass; other keys are masked when this is non-empty. */
  readonly allow?: readonly string[];
  /** Header names that are always masked. */
  readonly deny?: readonly string[];
}

export function headerRedactor(options: HeaderRedactionOptions = {}): RedactionMatcher {
  const allow = new Set((options.allow ?? []).map((name) => name.toLowerCase()));
  const deny = new Set((options.deny ?? []).map((name) => name.toLowerCase()));
  return (key) => {
    if (key === '') return false;
    const lower = key.toLowerCase();
    return deny.has(lower) || (allow.size > 0 && !allow.has(lower));
  };
}

export interface QueryRedactionOptions {
  /** Query parameter names to mask. */
  readonly params: readonly string[];
  /** Parameter names that may pass; other parameters are masked when non-empty. */
  readonly allow?: readonly string[];
}

const QUERY_TOKEN = /(?:^|[?&\s])([A-Za-z0-9_.-]+)\s*=/g;

export function queryRedactor(options: QueryRedactionOptions): RedactionMatcher {
  const params = new Set(options.params.map((name) => name.toLowerCase()));
  const allow = new Set((options.allow ?? []).map((name) => name.toLowerCase()));
  return (key, value) => {
    if (params.has(key.toLowerCase())) return true;
    if (typeof value !== 'string') return false;
    for (const match of value.matchAll(QUERY_TOKEN)) {
      const name = match[1]?.toLowerCase() ?? '';
      if (allow.size > 0 && !allow.has(name)) return true;
      if (params.has(name)) return true;
    }
    return false;
  };
}

export interface AdvancedRedactionOptions {
  readonly fields?: FieldRedactionOptions;
  readonly regex?: readonly RegExp[];
  readonly headers?: HeaderRedactionOptions;
  readonly query?: QueryRedactionOptions;
}

/** Compose matchers for `RedactionOptions.matchers` on a core pipeline or channel. */
export function createAdvancedRedactor(
  options: AdvancedRedactionOptions,
): readonly RedactionMatcher[] {
  const matchers: RedactionMatcher[] = [];
  if (options.fields !== undefined) matchers.push(fieldRedactor(options.fields));
  if (options.regex !== undefined) matchers.push(regexRedactor(options.regex));
  if (options.headers !== undefined) matchers.push(headerRedactor(options.headers));
  if (options.query !== undefined) matchers.push(queryRedactor(options.query));
  return matchers;
}
