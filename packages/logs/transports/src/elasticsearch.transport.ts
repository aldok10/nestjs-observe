import {
  stringField,
  type FormatterType,
  type LogFormatter,
} from '@aldok10/nestjs-observe-logger-core';
import {
  BufferedRemoteTransport,
  joinEndpoint,
  parseRecordFields,
  type BufferedRemoteTransportOptions,
  type RemotePayload,
} from '@aldok10/nestjs-observe-logger-delivery';

export interface ElasticsearchTransportOptions extends Omit<
  BufferedRemoteTransportOptions,
  'endpoint'
> {
  readonly endpoint?: string;
  readonly formatter?: FormatterType | LogFormatter;
  readonly index?: string;
  readonly apiKey?: string;
  readonly authorization?: string;
}

function normalizeIndexSegment(value: string | undefined): string {
  return (value ?? 'unknown').toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
}

export class ElasticsearchTransport extends BufferedRemoteTransport {
  private readonly index: string;

  constructor(options: ElasticsearchTransportOptions = {}) {
    const headers: Record<string, string> = { ...options.headers };
    if (options.apiKey !== undefined) headers['Authorization'] = `ApiKey ${options.apiKey}`;
    else if (options.authorization !== undefined) headers['Authorization'] = options.authorization;
    super({
      ...options,
      endpoint: joinEndpoint(options.endpoint ?? 'http://localhost:9200', '/_bulk'),
      headers,
      name: options.name ?? 'elasticsearch',
    });
    this.index = options.index ?? 'logs-{level}-{environment}';
  }

  protected buildPayload(batch: readonly string[]): RemotePayload {
    const lines: string[] = [];
    for (const line of batch) {
      const fields = parseRecordFields(line);
      const action = { index: { _index: this.resolveIndex(fields) } };
      lines.push(JSON.stringify(action), JSON.stringify(fields));
    }
    return {
      body: `${lines.join('\n')}\n`,
      headers: { 'Content-Type': 'application/x-ndjson' },
    };
  }

  private resolveIndex(fields: Readonly<Record<string, unknown>>): string {
    return this.index
      .replaceAll('{level}', normalizeIndexSegment(stringField(fields, 'level')))
      .replaceAll('{environment}', normalizeIndexSegment(stringField(fields, 'environment')));
  }
}
