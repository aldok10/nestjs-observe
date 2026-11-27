import { gzipSync } from 'node:zlib';
import type { FormatterType, LogFormatter } from '@aldok10/nestjs-observe-logger-core/contracts';
import { stringField } from '@aldok10/nestjs-observe-logger-core/formatters';
import {
  BufferedRemoteTransport,
  joinEndpoint,
  parseRecordFields,
  type BufferedRemoteTransportOptions,
  type RemotePayload,
} from '@aldok10/nestjs-observe-logger-delivery';

export interface LokiTransportOptions extends Omit<BufferedRemoteTransportOptions, 'endpoint'> {
  readonly endpoint?: string;
  readonly formatter?: FormatterType | LogFormatter;
  readonly tenantId?: string;
  readonly authorization?: string;
  readonly gzip?: boolean;
  readonly extraLabels?: Readonly<Record<string, string | number>> | readonly string[];
  readonly extraLabelAllowlist?: readonly string[];
}

const HIGH_CARDINALITY_LABELS = new Set(['requestId', 'traceId', 'spanId', 'correlationId']);
const ID_KEYS = ['requestId', 'traceId', 'spanId', 'correlationId'] as const;

function nestedStringField(
  fields: Readonly<Record<string, unknown>>,
  parent: string,
  key: string,
): string | undefined {
  const value = fields[parent];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const nested: unknown = Reflect.get(value, key);
  return typeof nested === 'string' ? nested : undefined;
}

export class LokiTransport extends BufferedRemoteTransport {
  private readonly tenantId: string | undefined;
  private readonly authorization: string | undefined;
  private readonly gzip: boolean;
  private readonly extraLabels:
    Readonly<Record<string, string | number>> | readonly string[] | undefined;
  private readonly extraLabelAllowlist: ReadonlySet<string> | undefined;

  constructor(options: LokiTransportOptions = {}) {
    const endpoint = options.endpoint ?? 'http://localhost:3100';
    super({
      ...options,
      endpoint: joinEndpoint(endpoint, '/loki/api/v1/push'),
      name: options.name ?? 'loki',
    });
    this.tenantId = options.tenantId;
    this.authorization = options.authorization;
    this.gzip = options.gzip ?? true;
    this.extraLabels = options.extraLabels;
    this.extraLabelAllowlist = options.extraLabelAllowlist
      ? new Set(options.extraLabelAllowlist)
      : undefined;
  }

  protected buildPayload(batch: readonly string[]): RemotePayload {
    const streams = new Map<string, { stream: Record<string, string>; values: unknown[][] }>();
    for (const line of batch) {
      const fields = parseRecordFields(line);
      const labels = this.buildLabels(fields);
      const key = JSON.stringify(labels);
      let stream = streams.get(key);
      if (!stream) {
        stream = { stream: labels, values: [] };
        streams.set(key, stream);
      }
      const timestamp = fields['timestamp'];
      const millis =
        typeof timestamp === 'number' && Number.isFinite(timestamp)
          ? Math.trunc(timestamp)
          : Date.now();
      const metadata: Record<string, string> = {};
      for (const idKey of ID_KEYS) {
        const value = stringField(fields, idKey);
        if (value !== undefined) metadata[idKey] = value;
      }
      stream.values.push([`${BigInt(millis) * 1_000_000n}`, line, metadata]);
    }

    const body = JSON.stringify({ streams: [...streams.values()] });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.tenantId !== undefined) headers['X-Scope-OrgID'] = this.tenantId;
    if (this.authorization !== undefined) headers['Authorization'] = this.authorization;
    if (this.gzip) {
      headers['Content-Encoding'] = 'gzip';
      return { body: gzipSync(body), headers };
    }
    return { body, headers };
  }

  private buildLabels(fields: Readonly<Record<string, unknown>>): Record<string, string> {
    const labels: Record<string, string> = {};
    const stable: Readonly<Record<string, string | undefined>> = {
      application: stringField(fields, 'application'),
      environment: stringField(fields, 'environment'),
      service: stringField(fields, 'service'),
      level: stringField(fields, 'level'),
      region: stringField(fields, 'region') ?? nestedStringField(fields, 'metadata', 'region'),
      instance: stringField(fields, 'instanceId') ?? stringField(fields, 'hostname'),
    };
    for (const [key, value] of Object.entries(stable)) {
      if (value !== undefined) labels[key] = value;
    }
    this.addExtraLabels(labels, fields);
    return labels;
  }

  private addExtraLabels(
    labels: Record<string, string>,
    fields: Readonly<Record<string, unknown>>,
  ): void {
    const extra = this.extraLabels;
    if (!extra) return;
    const entries: Array<readonly [string, string | number | undefined]> = [];
    if (Array.isArray(extra)) {
      for (const key of extra) {
        if (typeof key === 'string') {
          entries.push([
            key,
            stringField(fields, key) ?? nestedStringField(fields, 'metadata', key),
          ]);
        }
      }
    } else {
      for (const [key, value] of Object.entries(extra)) {
        entries.push([key, value]);
      }
    }
    for (const [key, value] of entries) {
      if (HIGH_CARDINALITY_LABELS.has(key)) continue;
      if (this.extraLabelAllowlist && !this.extraLabelAllowlist.has(key)) continue;
      if (typeof value === 'string') labels[key] = value;
      else if (typeof value === 'number' && Number.isFinite(value)) labels[key] = String(value);
    }
  }
}
