import { randomBytes, randomUUID } from 'node:crypto';
import type { LogContext } from '../contracts/index.js';

export function generateRequestId(): string {
  return randomUUID();
}

export function generateCorrelationId(): string {
  return randomUUID();
}

/** 16-byte hex trace id (W3C trace-context shape). */
export function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}

/** 8-byte hex span id (W3C trace-context shape). */
export function generateSpanId(): string {
  return randomBytes(8).toString('hex');
}

export function createCorrelationContext(
  seed: Partial<LogContext> = {},
): Pick<LogContext, 'requestId' | 'correlationId'> & Partial<LogContext> {
  return {
    requestId: seed.requestId ?? generateRequestId(),
    correlationId: seed.correlationId ?? generateCorrelationId(),
    ...seed,
  };
}
