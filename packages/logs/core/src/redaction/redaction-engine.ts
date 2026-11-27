import type { LogRecord, RedactionMatcher, RedactionOptions } from '../contracts/index.js';

export type SafeValue =
  null | boolean | number | string | readonly SafeValue[] | { readonly [key: string]: SafeValue };

const DEFAULT_PATTERNS = [
  'password',
  'authorization',
  'accesstoken',
  'refreshtoken',
  'apikey',
  'secret',
  'clientsecret',
  'cookie',
  'session',
  'privatekey',
  'credentials',
  'cardnumber',
  'cvv',
] as const;

const DEFAULT_REPLACEMENT = '[REDACTED]';
const DEFAULT_MAX_DEPTH = 6;
const DEFAULT_MAX_KEYS = 64;
const DEFAULT_MAX_STRING_LENGTH = 4096;
const TRUNCATION_SUFFIX = '...[truncated]';
const SANITIZED_RECORDS = new WeakSet<object>();

interface NormalizedRedactionPolicy {
  readonly patterns: readonly (string | RegExp)[];
  readonly allowlist: ReadonlySet<string>;
  readonly denylist: ReadonlySet<string>;
  readonly matchers: readonly RedactionMatcher[];
  readonly replacement: string;
  readonly maxDepth: number;
  readonly maxKeys: number;
  readonly maxStringLength: number;
}

export class RedactionEngine {
  private readonly policy: NormalizedRedactionPolicy;

  constructor(options: RedactionOptions = {}) {
    this.policy = {
      // Defaults are always active: callers cannot accidentally disable redaction.
      patterns: [...DEFAULT_PATTERNS, ...(options.patterns ?? [])],
      allowlist: new Set((options.allowlist ?? []).map((key) => key.toLowerCase())),
      denylist: new Set((options.denylist ?? []).map((key) => key.toLowerCase())),
      matchers: options.matchers ?? [],
      replacement: options.replacement ?? DEFAULT_REPLACEMENT,
      maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
      maxKeys: options.maxKeys ?? DEFAULT_MAX_KEYS,
      maxStringLength: options.maxStringLength ?? DEFAULT_MAX_STRING_LENGTH,
    };
  }

  static safeString(value: unknown, maxLength = DEFAULT_MAX_STRING_LENGTH): string {
    if (typeof value === 'string') return truncateText(value, maxLength);
    if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
      return truncateText(String(value), maxLength);
    }
    if (typeof value === 'symbol') return truncateText(String(value), maxLength);
    if (value === null || value === undefined) return '';
    if (value instanceof Error) return truncateText(value.message, maxLength);
    return '[Object]';
  }

  static markSanitized<T extends object>(value: T): T {
    SANITIZED_RECORDS.add(value);
    return value;
  }

  static isSanitized(value: unknown): boolean {
    return typeof value === 'object' && value !== null && SANITIZED_RECORDS.has(value);
  }

  sanitize(value: unknown): SafeValue {
    return this.visit(value, '', 0, new WeakSet<object>());
  }

  redactRecord(record: LogRecord): LogRecord {
    try {
      const safe = this.sanitize(record);
      if (isSanitizedLogRecord(safe)) {
        return RedactionEngine.markSanitized(safe);
      }
    } catch {
      // A throwing matcher or pattern must never release the raw record.
    }
    return {
      schemaVersion: record.schemaVersion,
      timestamp: record.timestamp,
      level: 'error',
      message: this.policy.replacement,
    };
  }

  private visit(value: unknown, key: string, depth: number, seen: WeakSet<object>): SafeValue {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return this.redactString(value, key);
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : String(value);
    }
    if (typeof value === 'bigint' || typeof value === 'symbol') {
      return truncateText(String(value), this.policy.maxStringLength);
    }
    if (typeof value === 'function') return '[Function]';
    if (typeof value !== 'object') return '[Object]';

    if (this.isSensitiveKey(key, value)) return this.policy.replacement;
    if (seen.has(value)) return '[Circular]';
    if (depth >= this.policy.maxDepth) return '[Max depth]';

    seen.add(value);
    try {
      return this.visitObject(value, depth, seen);
    } finally {
      seen.delete(value);
    }
  }

  private visitObject(value: object, depth: number, seen: WeakSet<object>): SafeValue {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? '[Invalid Date]' : value.toISOString();
    }
    if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
    if (value instanceof Error) {
      const result: Record<string, SafeValue> = {
        name: this.redactString(
          readProperty(value, 'name') === undefined
            ? 'Error'
            : RedactionEngine.safeString(readProperty(value, 'name')),
          'name',
        ),
        message: this.redactString(RedactionEngine.safeString(value.message), 'message'),
      };
      if (typeof value.stack === 'string') {
        result['stack'] = this.redactString(value.stack, 'stack');
      }
      return result;
    }
    if (Array.isArray(value)) {
      return value
        .slice(0, Math.max(0, this.policy.maxKeys))
        .map((item) => this.visit(item, '', depth + 1, seen));
    }
    if (value instanceof Map) {
      const result: Record<string, SafeValue> = {};
      let count = 0;
      for (const [mapKey, mapValue] of value) {
        if (count >= this.policy.maxKeys) break;
        const childKey = RedactionEngine.safeString(mapKey, 128);
        result[childKey] = this.isSensitiveKey(childKey, mapValue)
          ? this.policy.replacement
          : this.visit(mapValue, childKey, depth + 1, seen);
        count += 1;
      }
      return result;
    }
    if (value instanceof Set) {
      return Array.from(value)
        .slice(0, Math.max(0, this.policy.maxKeys))
        .map((item) => this.visit(item, '', depth + 1, seen));
    }

    let keys: string[];
    try {
      keys = Object.keys(value);
    } catch {
      return '[Unreadable]';
    }
    const result: Record<string, SafeValue> = {};
    let count = 0;
    for (const childKey of keys) {
      if (count >= this.policy.maxKeys) break;
      count += 1;
      const rawChild = readProperty(value, childKey);
      result[childKey] = this.isSensitiveKey(childKey, rawChild)
        ? this.policy.replacement
        : this.visit(rawChild, childKey, depth + 1, seen);
    }
    return result;
  }

  private redactString(value: string, key: string): string {
    if (this.isSensitiveString(value, key)) return this.policy.replacement;
    return truncateText(value, this.policy.maxStringLength);
  }

  private matchesSafely(key: string, value: unknown): boolean {
    // A throwing custom matcher must fail closed, never fall back to the raw record.
    try {
      for (const matcher of this.policy.matchers) {
        try {
          if (matcher(key, value)) return true;
        } catch {
          return true;
        }
      }
    } catch {
      return true;
    }
    return false;
  }

  private isSensitiveString(value: string, key: string): boolean {
    if (this.matchesSafely(key, value)) return true;
    for (const pattern of this.policy.patterns) {
      if (typeof pattern === 'string') {
        if (hasKeyToken(value, pattern.toLowerCase())) return true;
        continue;
      }
      if (testPattern(pattern, value)) return true;
    }
    for (const name of this.policy.denylist) {
      if (hasKeyToken(value, name)) return true;
    }
    return false;
  }

  private isSensitiveKey(key: string, value: unknown): boolean {
    if (key === '') return false;
    const lower = key.toLowerCase();
    if (this.matchesSafely(key, value)) return true;
    if (this.policy.denylist.has(lower)) return true;
    if (this.policy.allowlist.has(lower)) return false;
    return this.policy.patterns.some((pattern) => matchesPattern(lower, pattern));
  }
}

function truncateText(value: string, maxLength: number): string {
  const limit = Math.max(0, Math.floor(maxLength));
  if (value.length <= limit) return value;
  if (limit <= TRUNCATION_SUFFIX.length) return value.slice(0, limit);
  return `${value.slice(0, limit - TRUNCATION_SUFFIX.length)}${TRUNCATION_SUFFIX}`;
}

function matchesPattern(key: string, pattern: string | RegExp): boolean {
  if (typeof pattern === 'string') return key.includes(pattern.toLowerCase());
  return testPattern(pattern, key);
}

function testPattern(pattern: RegExp, value: string): boolean {
  try {
    pattern.lastIndex = 0;
    return pattern.test(value);
  } catch {
    // A throwing RegExp fails closed instead of leaking the value.
    return true;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isSanitizedLogRecord(value: unknown): value is LogRecord {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'schemaVersion' in value &&
    'timestamp' in value &&
    'level' in value &&
    'message' in value
  );
}

function hasKeyToken(value: string, name: string): boolean {
  if (name.length === 0) return false;
  const pattern = new RegExp(`(?:^|[\\s,{])["']?${escapeRegExp(name)}["']?\\s*(?:=|:)\\s*`, 'i');
  return pattern.test(value);
}

function readProperty(target: object, key: string): unknown {
  try {
    return Reflect.get(target, key);
  } catch {
    return undefined;
  }
}

const DEFAULT_REDACTION_ENGINE = new RedactionEngine();

export function safeString(value: unknown, maxLength = DEFAULT_MAX_STRING_LENGTH): string {
  return RedactionEngine.safeString(value, maxLength);
}

export function markSanitized<T extends object>(value: T): T {
  return RedactionEngine.markSanitized(value);
}

export function isSanitized(value: unknown): boolean {
  return RedactionEngine.isSanitized(value);
}

export function sanitize(value: unknown, options?: RedactionOptions): SafeValue {
  if (options === undefined) return DEFAULT_REDACTION_ENGINE.sanitize(value);
  return new RedactionEngine(options).sanitize(value);
}
