import type { Attributes, AttributeValue } from '@opentelemetry/api';
import type { CardinalityGuardOptions } from './metrics.contracts.js';

const DEFAULT_FORBIDDEN_KEYS: readonly string[] = [
  'userId',
  'user_id',
  'requestId',
  'request_id',
  'correlationId',
  'correlation_id',
  'traceId',
  'trace_id',
  'spanId',
  'span_id',
  'sessionId',
  'session_id',
  'email',
  'ip',
  'clientIp',
  'client_ip',
];

const DEFAULT_MAX_DISTINCT_VALUES = 100;
const DEFAULT_OVERFLOW_VALUE = '__overflow__';

export class CardinalityGuard {
  private readonly forbidden: ReadonlySet<string>;
  private readonly maxDistinct: number;
  private readonly overflowValue: string;
  private readonly seenByKey = new Map<string, Set<string>>();

  constructor(options: CardinalityGuardOptions = {}) {
    this.forbidden = new Set(options.forbiddenKeys ?? DEFAULT_FORBIDDEN_KEYS);
    this.maxDistinct = Math.max(1, options.maxDistinctValuesPerKey ?? DEFAULT_MAX_DISTINCT_VALUES);
    this.overflowValue = options.overflowValue ?? DEFAULT_OVERFLOW_VALUE;
  }

  sanitize(attributes: Attributes | undefined): Attributes | undefined {
    if (attributes === undefined) return undefined;
    const safe: Record<string, AttributeValue> = {};
    for (const [key, value] of Object.entries(attributes)) {
      if (value === undefined || this.forbidden.has(key)) continue;
      safe[key] = this.boundValue(key, value);
    }
    return safe;
  }

  private boundValue(key: string, value: AttributeValue): AttributeValue {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    let seen = this.seenByKey.get(key);
    if (seen === undefined) {
      seen = new Set<string>();
      this.seenByKey.set(key, seen);
    }
    if (seen.has(serialized)) return value;
    if (seen.size < this.maxDistinct) {
      seen.add(serialized);
      return value;
    }
    return this.overflowValue;
  }
}
