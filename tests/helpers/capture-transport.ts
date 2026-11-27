import { CaptureTransport } from '@aldok10/nestjs-observe-logger-testing';

/** Reuses the published testing-package capture transport; no third duplicate implementation. */
export function createCaptureTransport(name = 'capture'): CaptureTransport {
  return new CaptureTransport(name);
}

export type { CaptureTransport } from '@aldok10/nestjs-observe-logger-testing';
