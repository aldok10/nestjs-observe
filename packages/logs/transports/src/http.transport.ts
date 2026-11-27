import {
  BufferedRemoteTransport,
  parseRecordFields,
  type BufferedRemoteTransportOptions,
  type RemotePayload,
} from '@aldok10/nestjs-observe-logger-delivery';

export interface HttpTransportOptions extends BufferedRemoteTransportOptions {
  /**
   * HTTP method used when sending batches. Defaults to `POST`.
   * The underlying buffered transport issues requests through a fetch wrapper,
   * so this option is honored even though the base transport defaults to POST.
   */
  readonly method?: 'POST' | 'PUT' | 'PATCH';
  /** Convenience header merged as `Authorization` when provided. */
  readonly authorization?: string;
}

/**
 * Generic HTTP transport that extends {@link BufferedRemoteTransport}.
 *
 * Each flush sends a JSON array of parsed record fields (`Content-Type: application/json`).
 * Record fields are parsed with `parseRecordFields`, which preserves non-JSON formatter output
 * as `{ message }` and applies the core remote redaction rules.
 */
export class HttpTransport extends BufferedRemoteTransport {
  constructor(options: HttpTransportOptions) {
    const headers: Record<string, string> = { ...options.headers };
    if (options.authorization !== undefined) {
      headers['Authorization'] = options.authorization;
    }

    const baseFetch = options.fetchImpl ?? globalThis.fetch;
    const method = options.method ?? 'POST';
    const fetchImpl: typeof fetch = (input, init) => baseFetch(input, { ...init, method });

    super({
      ...options,
      endpoint: options.endpoint,
      headers,
      fetchImpl,
      name: options.name ?? 'http',
    });
  }

  protected buildPayload(batch: readonly string[]): RemotePayload {
    return {
      body: JSON.stringify(batch.map((line) => parseRecordFields(line))),
      headers: { 'Content-Type': 'application/json' },
    };
  }
}
