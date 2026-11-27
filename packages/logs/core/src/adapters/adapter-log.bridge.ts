import { LOG_CONTEXT_KEYS, LogContextMerger } from '../context/log-context.merger.js';
import {
  LOG_LEVELS,
  isLogLevel,
  type LogContext,
  type LogContextProvider,
  type LogLevel,
  type LogRecord,
  type LoggerAdapterOptions,
  type UniversalLogger,
} from '../contracts/index.js';
import { InvalidLoggerConfigurationException } from '../exceptions/index.js';
import { LogRecordFactory } from '../record/log-record.factory.js';
import { RedactionEngine, type SafeValue } from '../redaction/redaction-engine.js';

export const UNIVERSAL_LEVELS = LOG_LEVELS;

export interface AdapterOptionsBase extends LoggerAdapterOptions {
  readonly sink?: (record: LogRecord) => void | Promise<void>;
  readonly ownership?: 'backend' | 'package' | 'both';
  readonly levelMap?: Partial<Record<LogLevel, string>>;
  readonly contextStore?: LogContextProvider | undefined;
}

export interface AdapterLogger extends UniversalLogger {
  child(context: LogContext): AdapterLogger;
  setLogLevels?(levels: readonly LogLevel[]): void;
}

export type LevelMap = Partial<Record<LogLevel, string>>;
export type ResolvedLevelMap = Readonly<Record<LogLevel, string>>;

export const isUniversalLevel = isLogLevel;

export class LevelMappingResolver {
  resolve(
    name: string,
    defaults: ResolvedLevelMap,
    overrides: LevelMap | undefined,
    supportedLevels: readonly string[],
  ): ResolvedLevelMap {
    const resolved: Record<LogLevel, string> = { ...defaults };
    if (overrides === undefined) return resolved;

    for (const [key, value] of Object.entries(overrides)) {
      if (!isLogLevel(key)) {
        throw new InvalidLoggerConfigurationException(
          `${name}Adapter: unknown universal level "${key}" in levelMap`,
        );
      }
      if (typeof value !== 'string' || !supportedLevels.includes(value)) {
        const displayValue = value ?? 'undefined';
        throw new InvalidLoggerConfigurationException(
          `${name}Adapter: unsupported ${name} level "${displayValue}" for "${key}" in levelMap`,
        );
      }
      resolved[key] = value;
    }
    return resolved;
  }
}

export interface AdapterBridgeParams<TBackend> {
  readonly name: string;
  readonly backend: TBackend;
  readonly options: AdapterOptionsBase;
  readonly levelMap: ResolvedLevelMap;
  readonly supportedLevels: readonly string[];
  readonly fallbackLevel: string;
  readonly write: (backend: TBackend, method: string, record: LogRecord) => void;
  readonly deriveChild?: (backend: TBackend, context: LogContext) => TBackend | undefined;
  readonly setLevels?: (backend: TBackend, levels: readonly LogLevel[]) => void;
}

export type CreateAdapterLoggerParams<TBackend> = AdapterBridgeParams<TBackend>;

export class AdapterLogBridge<TBackend> {
  private readonly contextMerger = new LogContextMerger();
  private readonly recordFactory = new LogRecordFactory();
  private readonly redactionEngine: RedactionEngine;
  private readonly baseContext: LogContext | undefined;
  private readonly deliverToSink: boolean;
  private readonly deliverToBackend: boolean;

  constructor(
    private readonly params: AdapterBridgeParams<TBackend>,
    inheritedContext?: LogContext,
  ) {
    this.redactionEngine = new RedactionEngine(params.options.redaction);
    this.baseContext = this.mergeContext([params.options.context, inheritedContext]);
    const ownership =
      params.options.ownership ?? (params.options.sink !== undefined ? 'package' : 'backend');
    this.deliverToSink = ownership === 'package' || ownership === 'both';
    this.deliverToBackend = ownership === 'backend' || ownership === 'both';
  }

  static resolveMethod(
    backend: object,
    mapped: string,
    fallbackLevel: string,
    supportedLevels: readonly string[],
  ): string | undefined {
    // Fallback rule: an absent mapped method falls back to the adapter's canonical
    // method, then to any supported method, so a mapped level is never dropped.
    for (const candidate of [mapped, fallbackLevel, ...supportedLevels]) {
      if (typeof Reflect.get(backend, candidate) === 'function') return candidate;
    }
    return undefined;
  }

  createLogger(): AdapterLogger {
    const { backend, setLevels } = this.params;
    return {
      trace: (message, ...rest) => this.emit('trace', message, ...rest),
      debug: (message, ...rest) => this.emit('debug', message, ...rest),
      verbose: (message, ...rest) => this.emit('verbose', message, ...rest),
      info: (message, ...rest) => this.emit('info', message, ...rest),
      log: (message, ...rest) => this.emit('log', message, ...rest),
      warn: (message, ...rest) => this.emit('warn', message, ...rest),
      error: (message, ...rest) => this.emit('error', message, ...rest),
      fatal: (message, ...rest) => this.emit('fatal', message, ...rest),
      child: (context) => this.createChild(context),
      ...(setLevels !== undefined
        ? { setLogLevels: (levels: readonly LogLevel[]) => setLevels(backend, levels) }
        : {}),
    };
  }

  private emit(level: LogLevel, message: unknown, ...rest: unknown[]): void {
    const parsed = this.contextMerger.parseLoggerServiceArgs(level, [message, ...rest]);
    const ambient = this.params.options.contextStore?.getContext();
    const context = this.mergeContext([ambient, this.baseContext, parsed.context]);
    const record = this.normalizeRecord(
      level,
      parsed.error instanceof Error ? parsed.error : parsed.message,
      context,
      parsed.error,
    );

    if (this.deliverToSink && this.params.options.sink !== undefined) {
      const result = this.params.options.sink(record);
      if (result !== undefined && typeof result.then === 'function') {
        void result.catch(() => undefined);
      }
    }

    if (
      this.deliverToBackend &&
      typeof this.params.backend === 'object' &&
      this.params.backend !== null
    ) {
      const { backend, levelMap, fallbackLevel, supportedLevels, write } = this.params;
      const method = AdapterLogBridge.resolveMethod(
        backend,
        levelMap[level] ?? fallbackLevel,
        fallbackLevel,
        supportedLevels,
      );
      if (method !== undefined) write(backend, method, record);
    }
  }

  private createChild(context: LogContext): AdapterLogger {
    const nextContext = this.mergeContext([this.baseContext, context]);
    const nextBackend =
      this.params.deriveChild?.(this.params.backend, nextContext ?? {}) ?? this.params.backend;
    return new AdapterLogBridge(
      { ...this.params, backend: nextBackend },
      nextContext,
    ).createLogger();
  }

  private mergeContext(layers: readonly (LogContext | undefined)[]): LogContext | undefined {
    const merged: Record<string, unknown> = {};
    for (const key of LOG_CONTEXT_KEYS) {
      for (let index = layers.length - 1; index >= 0; index -= 1) {
        const value = layers[index]?.[key];
        if (value !== undefined) {
          merged[key] = value;
          break;
        }
      }
    }

    const metadata = this.cleanMetadata(layers.map((layer) => layer?.metadata));
    if (metadata !== undefined) merged['metadata'] = metadata;

    return Object.keys(merged).length === 0 ? undefined : merged;
  }

  private cleanMetadata(
    sources: readonly (Readonly<Record<string, unknown>> | undefined)[],
  ): Record<string, unknown> | undefined {
    const merged: Record<string, unknown> = {};
    try {
      for (const source of sources) {
        if (source === undefined) continue;
        for (const [key, value] of Object.entries(source)) merged[key] = value;
      }
    } catch {
      return undefined;
    }
    if (Object.keys(merged).length === 0) return undefined;

    const safe = this.redactionEngine.sanitize(merged);
    if (!isSafeRecord(safe) || Object.keys(safe).length === 0) return undefined;
    return safe;
  }

  private normalizeRecord(
    level: LogLevel,
    message: unknown,
    context: LogContext | undefined,
    parsedError: unknown,
  ): LogRecord {
    const error = pickError(message, context) ?? parsedError;
    const record = this.recordFactory.create({
      level,
      message: RedactionEngine.safeString(message),
      ...(context !== undefined ? { context } : {}),
      ...(error !== undefined ? { error } : {}),
    });

    // Keep the adapter's redaction result on metadata.
    return context?.metadata !== undefined ? { ...record, metadata: context.metadata } : record;
  }
}

function isSafeRecord(value: SafeValue): value is Readonly<Record<string, SafeValue>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickError(message: unknown, context: LogContext | undefined): unknown {
  if (message instanceof Error) return message;
  const metadata = context?.metadata;
  if (metadata === undefined) return undefined;

  const candidate = metadata['error'] ?? metadata['err'] ?? metadata['exception'];
  if (candidate instanceof Error) return candidate;
  if (typeof candidate === 'object' && candidate !== null && 'message' in candidate)
    return candidate;
  return undefined;
}

const DEFAULT_LEVEL_MAPPING_RESOLVER = new LevelMappingResolver();

export function resolveLevelMap(
  name: string,
  defaults: ResolvedLevelMap,
  overrides: LevelMap | undefined,
  supportedLevels: readonly string[],
): ResolvedLevelMap {
  return DEFAULT_LEVEL_MAPPING_RESOLVER.resolve(name, defaults, overrides, supportedLevels);
}

export function resolveMethod(
  backend: Record<string, unknown>,
  mapped: string,
  fallbackLevel: string,
  supportedLevels: readonly string[],
): string | undefined {
  return AdapterLogBridge.resolveMethod(backend, mapped, fallbackLevel, supportedLevels);
}

export function createAdapterLogger<TBackend>(
  params: AdapterBridgeParams<TBackend>,
  inheritedContext?: LogContext,
): AdapterLogger {
  return new AdapterLogBridge(params, inheritedContext).createLogger();
}
