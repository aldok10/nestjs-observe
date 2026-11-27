import type {
  BackendConfig,
  FormatterType,
  LogContext,
  LogFormatter,
  LogLevel,
  LogRecord,
  LogTransport,
  RedactionOptions,
} from '../contracts/index.js';

export type ChannelName = string;
export type UnknownChannelPolicy = 'throw' | 'drop' | 'create';
export type ChannelPredicate = (record: LogRecord, context: LogContext) => boolean;

export interface ChannelRoute<N extends ChannelName = ChannelName> {
  readonly to: N;
  readonly when?: ChannelPredicate;
}

/** Core channel behavior only. Destinations are supplied as LogTransport instances. */
export interface ChannelConfiguration<N extends ChannelName = ChannelName> {
  readonly name: N;
  readonly enabled?: boolean;
  readonly level?: LogLevel;
  readonly format?: FormatterType | LogFormatter;
  readonly redaction?: RedactionOptions;
  readonly filters?: readonly ChannelPredicate[];
  readonly transports?: readonly LogTransport[];
  readonly backend?: BackendConfig;
  readonly routes?: readonly ChannelRoute<N>[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ResolvedChannel<N extends ChannelName = ChannelName> {
  readonly name: N;
  readonly enabled: boolean;
  readonly level?: LogLevel;
  readonly format?: FormatterType | LogFormatter;
  readonly redaction?: RedactionOptions;
  readonly filters: readonly ChannelPredicate[];
  readonly transports: readonly LogTransport[];
  readonly backend?: BackendConfig;
  readonly routes: readonly ChannelRoute<N>[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ChannelsOptions<N extends ChannelName = ChannelName> {
  readonly channels: readonly ChannelConfiguration<N>[];
  readonly defaultChannel?: N;
  readonly unknownChannel?: UnknownChannelPolicy;
  readonly onUnknownChannel?: (name: string) => ChannelConfiguration | undefined;
  readonly shutdownTimeoutMs?: number;
}
