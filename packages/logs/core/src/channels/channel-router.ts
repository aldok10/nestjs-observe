import {
  levelIndex,
  type LogContext,
  type LogLevel,
  type LogRecord,
  type TransportHealth,
} from '../contracts/index.js';
import type { LogPipeline } from '../pipeline/log-pipeline.js';
import type { ChannelName, ChannelPredicate } from './channel.contracts.js';
import type { ChannelRegistry } from './channel-registry.js';

export interface ChannelRouteEvent<N extends ChannelName = ChannelName> {
  readonly origin: N;
  readonly record: LogRecord;
  readonly context: LogContext;
}

export interface ChannelRouterOptions {
  readonly onError?: (error: unknown) => void;
  readonly maxIdentities?: number;
}

// FIFO set: overflow evicts the oldest identity and counts it as dropped.
class BoundedIdentitySet {
  private readonly values: string[] = [];
  private readonly seen = new Set<string>();
  dropped = 0;

  constructor(private readonly limit: number) {}

  has(id: string): boolean {
    return this.seen.has(id);
  }

  add(id: string): void {
    if (this.seen.has(id)) return;
    if (this.limit <= 0) {
      this.dropped += 1;
      return;
    }
    this.seen.add(id);
    this.values.push(id);
    if (this.values.length > this.limit) {
      const oldest = this.values.shift();
      if (oldest !== undefined) {
        this.seen.delete(oldest);
        this.dropped += 1;
      }
    }
  }
}

function identityOf(record: LogRecord): string {
  const extra = (record as LogRecord & { eventId?: unknown }).eventId;
  if (typeof extra === 'string') return extra;
  return [
    record.timestamp,
    record.level,
    record.message,
    record.context ?? '',
    record.traceId ?? '',
    record.requestId ?? '',
  ].join('|');
}

function isLevelAllowed(threshold: LogLevel | undefined, level: LogLevel): boolean {
  if (threshold === undefined) return true;
  return levelIndex(level) >= levelIndex(threshold);
}

export class ChannelRouter<N extends ChannelName = ChannelName> {
  private readonly identities: BoundedIdentitySet;
  private readonly seenRecords = new WeakSet<object>();

  constructor(
    private readonly registry: ChannelRegistry<N>,
    private readonly pipelines: ReadonlyMap<N, LogPipeline>,
    private readonly options: ChannelRouterOptions = {},
  ) {
    this.identities = new BoundedIdentitySet(options.maxIdentities ?? 4096);
  }

  get droppedIdentities(): number {
    return this.identities.dropped;
  }

  route(event: ChannelRouteEvent<N>): void {
    try {
      const { origin, record, context } = event;
      if (this.seenRecords.has(record)) return;
      this.seenRecords.add(record);
      const id = identityOf(record);
      if (this.identities.has(id)) return;
      this.identities.add(id);

      const visited = new Set<string>([origin]);
      const queue: string[] = [origin];
      const maxDepth = Math.min(this.registry.names().length, 32);
      let depth = 0;
      while (queue.length > 0 && depth <= maxDepth) {
        const batch = queue.splice(0, queue.length);
        for (const name of batch) {
          this.deliverToChannel(name, record, context, visited, queue);
        }
        depth += 1;
      }
    } catch (error: unknown) {
      this.report(error);
    }
  }

  health(): Readonly<Record<string, readonly TransportHealth[]>> {
    const result: Record<string, readonly TransportHealth[]> = {};
    for (const [name, pipeline] of this.pipelines) result[name] = pipeline.health();
    return result;
  }

  private deliverToChannel(
    name: string,
    record: LogRecord,
    context: LogContext,
    visited: Set<string>,
    queue: string[],
  ): void {
    try {
      const channel = this.registry.get(name);
      if (!channel.enabled || !isLevelAllowed(channel.level, record.level)) return;
      if (channel.filters.some((filter) => !this.evaluatePredicate(filter, record, context)))
        return;
      const pipeline = (this.pipelines as ReadonlyMap<string, LogPipeline>).get(name);
      if (pipeline !== undefined) {
        void pipeline.emit(record).catch((error: unknown) => this.report(error));
      }
      for (const route of channel.routes) {
        if (route.when !== undefined && !this.evaluatePredicate(route.when, record, context))
          continue;
        if (visited.has(route.to)) continue;
        visited.add(route.to);
        queue.push(route.to);
      }
    } catch (error: unknown) {
      this.report(error);
    }
  }

  private evaluatePredicate(
    filter: ChannelPredicate,
    record: LogRecord,
    context: LogContext,
  ): boolean {
    try {
      return filter(record, context);
    } catch (error: unknown) {
      this.report(error);
      return false;
    }
  }

  private report(error: unknown): void {
    try {
      this.options.onError?.(error);
    } catch {
      // Diagnostics must not break fan-out.
    }
  }
}
