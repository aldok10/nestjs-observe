export type EnvSource = Readonly<Record<string, string | undefined>>;

const DEFAULT_ENV: EnvSource = process.env;

export function readEnv(name: string, env: EnvSource = DEFAULT_ENV): string | undefined {
  const value = env[name];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export function readProcessEnvelope(env: EnvSource = DEFAULT_ENV): {
  readonly service?: string;
  readonly application?: string;
  readonly environment?: string;
  readonly instanceId?: string;
} {
  const service = readEnv('SERVICE_NAME', env) ?? readEnv('APP_NAME', env);
  const application = readEnv('APPLICATION_NAME', env);
  const environment = readEnv('NODE_ENV', env);
  const instanceId = readEnv('INSTANCE_ID', env);
  return {
    ...(service !== undefined ? { service } : {}),
    ...(application !== undefined ? { application } : {}),
    ...(environment !== undefined ? { environment } : {}),
    ...(instanceId !== undefined ? { instanceId } : {}),
  };
}
