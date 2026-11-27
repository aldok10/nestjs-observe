import { BufferedRemoteTransport, type RemotePayload } from './buffered-remote.transport.js';

/** Shared in-package test subclass: JSON-array payload, no external wire format. */
export class TestCaptureRemoteTransport extends BufferedRemoteTransport {
  protected buildPayload(batch: readonly string[]): RemotePayload {
    return { body: JSON.stringify(batch) };
  }
}
