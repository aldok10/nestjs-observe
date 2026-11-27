export type HealthState = 'healthy' | 'degraded' | 'unhealthy' | 'stopped';

export interface ComponentHealth {
  readonly name: string;
  readonly state: HealthState;
  readonly message?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface LifecycleParticipant {
  readonly name: string;
  initialize?(): Promise<void> | void;
  flush?(timeoutMs?: number): Promise<void>;
  shutdown(timeoutMs?: number): Promise<void>;
  health?(): ComponentHealth | Promise<ComponentHealth>;
}
