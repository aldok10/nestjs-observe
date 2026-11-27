import { describe, expect, it } from 'vitest';
import { InvalidLoggerConfigurationException } from '../exceptions/index.js';
import { LOGGER_CONFIG_DEFAULTS, readLoggerConfigFromEnv, resolveLoggerConfig } from './index.js';

describe('logger config', () => {
  it('uses defaults when no env or programmatic config provided', () => {
    const cfg = resolveLoggerConfig({ env: {} });
    expect(cfg).toEqual(LOGGER_CONFIG_DEFAULTS);
  });

  it('applies deterministic precedence defaults < env < programmatic', () => {
    const cfg = resolveLoggerConfig({
      env: {
        CISEA_LOG_LEVEL: 'warn',
        CISEA_LOG_SERVICE: 'env-service',
        CISEA_LOG_ENVIRONMENT: 'staging',
      },
      defaults: { level: 'debug', service: 'default-service', application: 'app' },
      programmatic: { level: 'error', service: 'prog-service' },
    });

    expect(cfg.level).toBe('error');
    expect(cfg.service).toBe('prog-service');
    expect(cfg.environment).toBe('staging');
    expect(cfg.application).toBe('app');
  });

  it('reads env config keys', () => {
    expect(
      readLoggerConfigFromEnv({
        CISEA_LOG_LEVEL: 'debug',
        CISEA_LOG_SERVICE: 'svc',
        CISEA_LOG_APPLICATION: 'app',
        CISEA_LOG_ENVIRONMENT: 'prod',
        CISEA_LOG_INSTANCE_ID: 'i-1',
      }),
    ).toEqual({
      level: 'debug',
      service: 'svc',
      application: 'app',
      environment: 'prod',
      instanceId: 'i-1',
    });
  });

  it('rejects invalid config', () => {
    expect(() =>
      resolveLoggerConfig({ programmatic: { level: 'loud' as unknown as 'info' } }),
    ).toThrow(InvalidLoggerConfigurationException);
    expect(() =>
      resolveLoggerConfig({ programmatic: { service: 123 as unknown as string } }),
    ).toThrow(InvalidLoggerConfigurationException);
  });
});
