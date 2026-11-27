import {
  BufferedRemoteTransport,
  joinEndpoint,
  parseRecordFields,
  type BufferedRemoteTransportOptions,
  type RemotePayload,
} from '@aldok10/nestjs-observe-logger-delivery';

export interface OtlpLogTransportOptions extends Omit<BufferedRemoteTransportOptions, 'endpoint'> {
  readonly endpoint?: string;
  readonly path?: string;
  readonly serviceName?: string;
  readonly serviceVersion?: string;
  readonly environment?: string;
  readonly resourceAttributes?: Readonly<Record<string, string | number | boolean>>;
  readonly scopeName?: string;
  readonly scopeVersion?: string;
}

interface OtlpKeyValue {
  readonly key: string;
  readonly value:
    | { readonly stringValue: string }
    | { readonly intValue: string }
    | { readonly doubleValue: number }
    | { readonly boolValue: boolean };
}

const SEVERITY_NUMBERS: Readonly<Record<string, number>> = {
  trace: 1,
  debug: 5,
  verbose: 5,
  info: 9,
  log: 9,
  warn: 13,
  error: 17,
  fatal: 21,
};

function toAnyValue(value: unknown): OtlpKeyValue['value'] {
  if (typeof value === 'boolean') return { boolValue: value };
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
  }
  return { stringValue: typeof value === 'string' ? value : JSON.stringify(value) };
}

function toAttributes(fields: Readonly<Record<string, unknown>>): OtlpKeyValue[] {
  const result: OtlpKeyValue[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    result.push({ key, value: toAnyValue(value) });
  }
  return result;
}

function toTimeUnixNano(timestamp: unknown): string {
  const ms = typeof timestamp === 'number' && Number.isFinite(timestamp) ? timestamp : Date.now();
  return (BigInt(Math.trunc(ms)) * 1_000_000n).toString();
}

export class OtlpLogTransport extends BufferedRemoteTransport {
  private readonly resourceAttributes: OtlpKeyValue[];
  private readonly scopeName: string;
  private readonly scopeVersion: string | undefined;

  constructor(options: OtlpLogTransportOptions = {}) {
    const endpoint = options.endpoint ?? 'http://localhost:4318';
    const path = options.path ?? '/v1/logs';
    super({
      ...options,
      endpoint: joinEndpoint(endpoint, path.startsWith('/') ? path : `/${path}`),
      name: options.name ?? 'otlp',
    });

    const resource: Record<string, string | number | boolean> = {
      ...options.resourceAttributes,
    };
    if (options.serviceName !== undefined) resource['service.name'] = options.serviceName;
    if (options.serviceVersion !== undefined) resource['service.version'] = options.serviceVersion;
    if (options.environment !== undefined) {
      resource['deployment.environment.name'] = options.environment;
    }

    this.resourceAttributes = toAttributes(resource);
    this.scopeName = options.scopeName ?? '@aldok10/nestjs-observe-logger-transports';
    this.scopeVersion = options.scopeVersion;
  }

  protected buildPayload(batch: readonly string[]): RemotePayload {
    const logRecords = batch.map((line) => {
      const fields = parseRecordFields(line);
      const level = typeof fields['level'] === 'string' ? fields['level'] : 'info';
      const message = typeof fields['message'] === 'string' ? fields['message'] : line;
      const traceId =
        typeof fields['traceId'] === 'string'
          ? fields['traceId']
          : typeof fields['trace_id'] === 'string'
            ? fields['trace_id']
            : undefined;
      const spanId =
        typeof fields['spanId'] === 'string'
          ? fields['spanId']
          : typeof fields['span_id'] === 'string'
            ? fields['span_id']
            : undefined;

      const attrFields: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(fields)) {
        if (
          key === 'timestamp' ||
          key === 'level' ||
          key === 'message' ||
          key === 'traceId' ||
          key === 'trace_id' ||
          key === 'spanId' ||
          key === 'span_id'
        ) {
          continue;
        }
        attrFields[key] = value;
      }

      return {
        timeUnixNano: toTimeUnixNano(fields['timestamp']),
        severityNumber: SEVERITY_NUMBERS[level] ?? 9,
        severityText: level.toUpperCase(),
        body: { stringValue: message },
        attributes: toAttributes(attrFields),
        ...(traceId !== undefined ? { traceId } : {}),
        ...(spanId !== undefined ? { spanId } : {}),
      };
    });

    const payload = {
      resourceLogs: [
        {
          resource: { attributes: this.resourceAttributes },
          scopeLogs: [
            {
              scope: {
                name: this.scopeName,
                ...(this.scopeVersion !== undefined ? { version: this.scopeVersion } : {}),
              },
              logRecords,
            },
          ],
        },
      ],
    };

    return {
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    };
  }
}
