import type { SerializedError } from '../contracts/index.js';
import { RedactionEngine } from '../redaction/redaction-engine.js';

const DEFAULT_MAX_CAUSE_DEPTH = 4;

export class ErrorSerializer {
  serialize(value: unknown, maxCauseDepth = DEFAULT_MAX_CAUSE_DEPTH): SerializedError {
    const limit = Number.isFinite(maxCauseDepth)
      ? Math.max(1, Math.floor(maxCauseDepth))
      : DEFAULT_MAX_CAUSE_DEPTH;
    return this.serializeNode(value, limit, 0, new WeakSet<object>());
  }

  private serializeNode(
    value: unknown,
    maxDepth: number,
    depth: number,
    seen: WeakSet<object>,
  ): SerializedError {
    const isObject = typeof value === 'object' && value !== null;
    if (isObject) seen.add(value);
    const rawName = isObject ? this.readProperty(value, 'name') : undefined;
    const rawMessage = isObject ? this.readProperty(value, 'message') : undefined;
    const name =
      RedactionEngine.safeString(rawName) ||
      (isObject ? 'Error' : RedactionEngine.safeString(value) || 'Error');
    let message = RedactionEngine.safeString(rawMessage);
    if (message === '' && !isObject) message = RedactionEngine.safeString(value);

    const result: {
      name: string;
      message: string;
      stack?: string;
      code?: string;
      cause?: SerializedError | string;
    } = { name, message };

    if (isObject) {
      const stack = this.readProperty(value, 'stack');
      if (typeof stack === 'string') result.stack = stack;
      const code = this.readProperty(value, 'code');
      if (typeof code === 'string' || typeof code === 'number') {
        result.code = RedactionEngine.safeString(code);
      }
      const cause = this.readProperty(value, 'cause');
      if (cause !== null && cause !== undefined) {
        if (depth + 1 >= maxDepth) {
          result.cause = '[Max cause depth exceeded]';
        } else if (typeof cause === 'object' && seen.has(cause)) {
          result.cause = '[Circular cause]';
        } else {
          result.cause = this.serializeNode(cause, maxDepth, depth + 1, seen);
        }
      }
    }

    return result;
  }

  private readProperty(target: object, key: string): unknown {
    try {
      return Reflect.get(target, key);
    } catch {
      return undefined;
    }
  }
}

const DEFAULT_ERROR_SERIALIZER = new ErrorSerializer();

export function serializeError(
  value: unknown,
  maxCauseDepth = DEFAULT_MAX_CAUSE_DEPTH,
): SerializedError {
  return DEFAULT_ERROR_SERIALIZER.serialize(value, maxCauseDepth);
}
