import type {
  AdapterOptionsBase,
  AdapterResolver,
  BackendConfig,
  LoggerAdapter,
  UniversalLogger,
} from '@aldok10/nestjs-observe-logger-core';

export function hasExternalBackend(backend: BackendConfig | undefined): backend is BackendConfig {
  if (backend === undefined) return false;
  return backend.logger !== undefined || backend.adapter !== undefined;
}

export function resolveBackendLogger(
  backend: BackendConfig,
  resolver: AdapterResolver,
  options: AdapterOptionsBase,
): UniversalLogger {
  const adapter: LoggerAdapter = backend.adapter ?? resolver.resolve(backend.type);
  return adapter.create(backend.logger, options);
}
