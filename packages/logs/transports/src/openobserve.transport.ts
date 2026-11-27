import type { FormatterType, LogFormatter } from '@aldok10/nestjs-observe-logger-core/contracts';
import {
  BufferedRemoteTransport,
  joinEndpoint,
  parseRecordFields,
  type BufferedRemoteTransportOptions,
  type RemotePayload,
} from '@aldok10/nestjs-observe-logger-delivery';

export interface OpenObserveTransportOptions extends Omit<
  BufferedRemoteTransportOptions,
  'endpoint'
> {
  readonly endpoint?: string;
  readonly formatter?: FormatterType | LogFormatter;
  readonly organization?: string;
  readonly stream?: string;
  readonly username?: string;
  readonly password?: string;
  readonly token?: string;
  readonly tokenName?: string;
}

export class OpenObserveTransport extends BufferedRemoteTransport {
  constructor(options: OpenObserveTransportOptions = {}) {
    const organization = options.organization ?? 'default';
    const stream = options.stream ?? 'logs';
    const credentials =
      options.token !== undefined
        ? `${options.tokenName ?? 'default'}:${options.token}`
        : `${options.username ?? ''}:${options.password ?? ''}`;
    const headers: Record<string, string> = { ...options.headers };
    if (options.token !== undefined || options.username !== undefined) {
      headers['Authorization'] = `Basic ${Buffer.from(credentials).toString('base64')}`;
    }
    super({
      ...options,
      endpoint: joinEndpoint(
        options.endpoint ?? 'http://localhost:5080',
        `/api/${encodeURIComponent(organization)}/${encodeURIComponent(stream)}/_json`,
      ),
      headers,
      name: options.name ?? 'openobserve',
    });
  }

  protected buildPayload(batch: readonly string[]): RemotePayload {
    return {
      body: JSON.stringify(batch.map((line) => parseRecordFields(line))),
      headers: { 'Content-Type': 'application/json' },
    };
  }
}
