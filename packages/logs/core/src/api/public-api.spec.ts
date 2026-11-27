import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface PackageManifest {
  readonly exports: Record<string, unknown>;
}

const EXPORT_MAP_KEYS = [
  '.',
  './contracts',
  './exceptions',
  './redaction',
  './formatters',
  './context',
] as const;

const REMOVED_SUBPATHS = [
  './adapters',
  './channels',
  './config',
  './lifecycle',
  './logger',
  './pipeline',
  './record',
  './resolver',
  './transports',
  './logger-service',
] as const;

const RUNTIME_EXPORTS = [
  'AdapterLogBridge',
  'AdapterNotFoundException',
  'AdapterResolver',
  'BoundedExecution',
  'ChannelLogger',
  'ChannelNotFoundException',
  'DuplicateAdapterException',
  'DuplicateChannelException',
  'ErrorSerializer',
  'FilterEngine',
  'InvalidLoggerConfigurationException',
  'LevelMappingResolver',
  'LifecycleManager',
  'LOG_LEVELS',
  'LOGGER_CONFIG_DEFAULTS',
  'LogContextStore',
  'LogPipeline',
  'LogRecordFactory',
  'LogRecordNormalizer',
  'LoggerException',
  'LoggerFactory',
  'LoggerManager',
  'OptionalPeerMissingException',
  'RedactionEngine',
  'TransportShutdownException',
  'UnknownChannelError',
  'UniversalLoggerImpl',
  'createCorrelationContext',
  'createLogRecord',
  'createLoggerManager',
  'defaultFormatter',
  'generateCorrelationId',
  'generateRequestId',
  'generateSpanId',
  'generateTraceId',
  'isLogLevel',
  'isSanitized',
  'levelIndex',
  'markSanitized',
  'mergeContexts',
  'normalizeLogLevel',
  'normalizeLoggerConfig',
  'readEnv',
  'readLoggerConfigFromEnv',
  'readProcessEnvelope',
  'registerFormatter',
  'resolveFormatter',
  'resolveLoggerConfig',
  'safeString',
  'sanitize',
  'serializeError',
  'stringField',
] as const;

const FORBIDDEN_NAMES = [
  'BackendTransportAdapter',
  'BufferedRemoteTransport',
  'ChannelConfigResolver',
  'ChannelRegistry',
  'ChannelRouter',
  'ConsoleTransport',
  'CustomBackendConfig',
  'FormatterResolver',
  'InMemoryCaptureTransport',
  'JsonLogFormatter',
  'LogContextMerger',
  'NestjsBackendConfig',
  'PinoBackendConfig',
  'PrettyJsonLogFormatter',
  'StreamTransport',
  'TextLogFormatter',
  'TransportManager',
  'WinstonBackendConfig',
  'hasExternalBackend',
  'resolveBackendLogger',
  'withTimeout',
] as const;

import type * as CoreRoot from '../index.js';

// @ts-expect-error NestjsBackendConfig was removed from the curated root
export type RemovedNestjsBackendConfig = CoreRoot.NestjsBackendConfig;
// @ts-expect-error PinoBackendConfig was removed from the curated root
export type RemovedPinoBackendConfig = CoreRoot.PinoBackendConfig;
// @ts-expect-error WinstonBackendConfig was removed from the curated root
export type RemovedWinstonBackendConfig = CoreRoot.WinstonBackendConfig;
// @ts-expect-error BackendTransportAdapter is owned by the NestJS integration now
export type RemovedBackendTransportAdapter = CoreRoot.BackendTransportAdapter;
// @ts-expect-error ConsoleTransport moved to @aldok10/nestjs-observe-logger-transport-console
export type RemovedConsoleTransport = CoreRoot.ConsoleTransport;
// @ts-expect-error StreamTransport moved to @aldok10/nestjs-observe-logger-transport-file
export type RemovedStreamTransport = CoreRoot.StreamTransport;

function readManifest(): PackageManifest {
  return JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as PackageManifest;
}

describe('core public API compatibility', () => {
  it('exposes exactly the curated export-map keys', () => {
    expect(Object.keys(readManifest().exports)).toEqual([...EXPORT_MAP_KEYS]);
  });

  it('does not expose removed subpaths in the export map', () => {
    const keys = Object.keys(readManifest().exports);
    expect(REMOVED_SUBPATHS.filter((subpath) => keys.includes(subpath))).toEqual([]);
  });

  it('exposes exactly the curated runtime names from the root', async () => {
    const root = await import('../index.js');
    expect(Object.keys(root).toSorted()).toEqual([...RUNTIME_EXPORTS].toSorted());
    expect(FORBIDDEN_NAMES.filter((name) => name in root)).toEqual([]);
  });
});
