import { randomUUID } from 'node:crypto';
import type {
  CaptureErrorInput,
  ErrorCauseInfo,
  ObserveErrorEvent,
} from './error-tracking.contracts.js';

const MAX_CAUSE_DEPTH = 8;
const MAX_AGGREGATE_ERRORS = 25;

function readErrorCode(value: unknown): string | number | undefined {
  if (typeof value !== 'object' || value === null || !('code' in value)) return undefined;
  const code = (value as { code?: unknown }).code;
  return typeof code === 'string' || typeof code === 'number' ? code : undefined;
}

function toCauseInfo(err: unknown): ErrorCauseInfo {
  if (err instanceof Error) {
    const code = readErrorCode(err);
    return {
      name: err.name || 'Error',
      message: err.message,
      ...(err.stack !== undefined ? { stack: err.stack } : {}),
      ...(code !== undefined ? { code } : {}),
    };
  }
  if (typeof err === 'string') {
    return { name: 'NonErrorException', message: err };
  }
  if (typeof err === 'object' && err !== null) {
    const name = 'name' in err && typeof err.name === 'string' ? err.name : 'NonErrorObject';
    const message =
      'message' in err && typeof err.message === 'string' ? err.message : safePreview(err);
    const code = readErrorCode(err);
    return {
      name,
      message,
      ...(code !== undefined ? { code } : {}),
    };
  }
  return { name: 'NonErrorException', message: String(err) };
}

function safePreview(value: object): string {
  try {
    const seen = new WeakSet<object>();
    return JSON.stringify(value, (_key, val: unknown) => {
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) return '[Circular]';
        seen.add(val);
      }
      return val;
    });
  } catch {
    return Object.prototype.toString.call(value);
  }
}

function extractCauses(root: unknown): readonly ErrorCauseInfo[] {
  const causes: ErrorCauseInfo[] = [];
  const seen = new WeakSet<object>();
  if (typeof root === 'object' && root !== null) seen.add(root);

  let current: unknown =
    typeof root === 'object' && root !== null && 'cause' in root
      ? (root as { cause?: unknown }).cause
      : undefined;

  while (current !== undefined && causes.length < MAX_CAUSE_DEPTH) {
    if (typeof current === 'object' && current !== null) {
      if (seen.has(current)) break;
      seen.add(current);
    }
    causes.push(toCauseInfo(current));
    current =
      typeof current === 'object' && current !== null && 'cause' in current
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  return causes;
}

function extractAggregateErrors(root: unknown): readonly ErrorCauseInfo[] {
  if (typeof root !== 'object' || root === null || !('errors' in root)) return [];
  const raw = (root as { errors?: unknown }).errors;
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_AGGREGATE_ERRORS).map((entry) => toCauseInfo(entry));
}

export function normalizeError(
  exception: unknown,
  input: CaptureErrorInput = {},
): ObserveErrorEvent {
  const base = toCauseInfo(exception);
  const causes = extractCauses(exception);
  const aggregateErrors = extractAggregateErrors(exception);

  return {
    id: randomUUID(),
    timestamp: new Date(),
    name: base.name,
    message: base.message,
    ...(base.stack !== undefined ? { stack: base.stack } : {}),
    ...(causes.length > 0 ? { causes } : {}),
    ...(aggregateErrors.length > 0 ? { aggregateErrors } : {}),
    severity: input.severity ?? 'error',
    handled: input.handled ?? true,
    ...(input.source !== undefined ? { source: input.source } : {}),
    ...(input.context !== undefined ? { context: input.context } : {}),
    ...(input.trace !== undefined ? { trace: input.trace } : {}),
    ...(input.user !== undefined ? { user: input.user } : {}),
    ...(input.request !== undefined ? { request: input.request } : {}),
    ...(input.job !== undefined ? { job: input.job } : {}),
    ...(input.database !== undefined ? { database: input.database } : {}),
    ...(input.attributes !== undefined ? { attributes: input.attributes } : {}),
    ...(input.tags !== undefined ? { tags: input.tags } : {}),
    ...(input.fingerprint !== undefined ? { fingerprint: input.fingerprint } : {}),
    ...(input.vendorContext !== undefined ? { vendorContext: input.vendorContext } : {}),
    exception,
  };
}

export function normalizeMessageEvent(
  message: string,
  input: CaptureErrorInput = {},
): ObserveErrorEvent {
  return {
    id: randomUUID(),
    timestamp: new Date(),
    name: 'Message',
    message,
    severity: input.severity ?? 'info',
    handled: input.handled ?? true,
    ...(input.source !== undefined ? { source: input.source } : {}),
    ...(input.context !== undefined ? { context: input.context } : {}),
    ...(input.trace !== undefined ? { trace: input.trace } : {}),
    ...(input.user !== undefined ? { user: input.user } : {}),
    ...(input.request !== undefined ? { request: input.request } : {}),
    ...(input.job !== undefined ? { job: input.job } : {}),
    ...(input.database !== undefined ? { database: input.database } : {}),
    ...(input.attributes !== undefined ? { attributes: input.attributes } : {}),
    ...(input.tags !== undefined ? { tags: input.tags } : {}),
    ...(input.fingerprint !== undefined ? { fingerprint: input.fingerprint } : {}),
    ...(input.vendorContext !== undefined ? { vendorContext: input.vendorContext } : {}),
  };
}
