import { isLogLevel, type LogLevel } from '../contracts/index.js';
import { InvalidLoggerConfigurationException } from '../exceptions/index.js';
import { readEnv, type EnvSource } from './env.js';

export interface LoggerConfig {
  readonly level: LogLevel;
  readonly service?: string;
  readonly application?: string;
  readonly environment?: string;
  readonly instanceId?: string;
}

export interface LoggerConfigInput {
  readonly level?: string;
  readonly service?: string;
  readonly application?: string;
  readonly environment?: string;
  readonly instanceId?: string;
}

export interface ResolveLoggerConfigOptions {
  readonly env?: EnvSource;
  readonly defaults?: LoggerConfigInput;
  readonly programmatic?: LoggerConfigInput;
}

export const LOGGER_CONFIG_DEFAULTS: Readonly<LoggerConfig> = Object.freeze({
  level: 'info',
});

const ENV_MAP = {
  level: 'CISEA_LOG_LEVEL',
  service: 'CISEA_LOG_SERVICE',
  application: 'CISEA_LOG_APPLICATION',
  environment: 'CISEA_LOG_ENVIRONMENT',
  instanceId: 'CISEA_LOG_INSTANCE_ID',
} as const;

function asOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new InvalidLoggerConfigurationException(`${field} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function asLevel(value: unknown, field: string): LogLevel | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !isLogLevel(value)) {
    throw new InvalidLoggerConfigurationException(`${field} must be a valid log level`);
  }
  return value;
}

export function readLoggerConfigFromEnv(env?: EnvSource): LoggerConfigInput {
  const level = readEnv(ENV_MAP.level, env);
  const service = readEnv(ENV_MAP.service, env);
  const application = readEnv(ENV_MAP.application, env);
  const environment = readEnv(ENV_MAP.environment, env);
  const instanceId = readEnv(ENV_MAP.instanceId, env);
  return {
    ...(level !== undefined ? { level } : {}),
    ...(service !== undefined ? { service } : {}),
    ...(application !== undefined ? { application } : {}),
    ...(environment !== undefined ? { environment } : {}),
    ...(instanceId !== undefined ? { instanceId } : {}),
  };
}

export function normalizeLoggerConfig(input: LoggerConfigInput): Partial<LoggerConfig> {
  const level = asLevel(input.level, 'level');
  const service = asOptionalString(input.service, 'service');
  const application = asOptionalString(input.application, 'application');
  const environment = asOptionalString(input.environment, 'environment');
  const instanceId = asOptionalString(input.instanceId, 'instanceId');
  return {
    ...(level !== undefined ? { level } : {}),
    ...(service !== undefined ? { service } : {}),
    ...(application !== undefined ? { application } : {}),
    ...(environment !== undefined ? { environment } : {}),
    ...(instanceId !== undefined ? { instanceId } : {}),
  };
}

export function resolveLoggerConfig(
  options: ResolveLoggerConfigOptions = {},
): Readonly<LoggerConfig> {
  // Deterministic precedence: defaults < environment < programmatic
  const envConfig = normalizeLoggerConfig(readLoggerConfigFromEnv(options.env));
  const defaults = normalizeLoggerConfig(options.defaults ?? {});
  const programmatic = normalizeLoggerConfig(options.programmatic ?? {});
  const resolved: LoggerConfig = {
    ...LOGGER_CONFIG_DEFAULTS,
    ...defaults,
    ...envConfig,
    ...programmatic,
  };
  return Object.freeze(resolved);
}
