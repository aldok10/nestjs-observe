import type {
  CaptureErrorInput,
  ErrorDatabaseContext,
  ErrorJobContext,
} from './error-tracking.contracts.js';
import type { ObserveErrorTracker } from './observe-error-tracker.service.js';

export interface JobErrorTrackingOptions {
  readonly reportOnFinalAttemptOnly?: boolean;
  readonly severity?: 'fatal' | 'error' | 'warning';
}

export async function captureJobError(
  tracker: ObserveErrorTracker,
  error: unknown,
  job: ErrorJobContext,
  options: JobErrorTrackingOptions = {},
): Promise<string | undefined> {
  if (
    options.reportOnFinalAttemptOnly === true &&
    job.attemptsMade !== undefined &&
    job.maxAttempts !== undefined &&
    job.attemptsMade < job.maxAttempts
  ) {
    return undefined;
  }

  const fingerprint: string[] = ['job'];
  if (job.queueName !== undefined) fingerprint.push(job.queueName);
  if (job.operation !== undefined) fingerprint.push(job.operation);
  if (error instanceof Error) fingerprint.push(error.name);

  const input: CaptureErrorInput = {
    severity: options.severity ?? 'error',
    handled: true,
    source: {
      component: job.workerName ?? 'queue-worker',
      ...(job.operation !== undefined ? { operation: job.operation } : {}),
    },
    context: {
      ...(job.jobId !== undefined ? { jobId: job.jobId } : {}),
      ...(job.workerName !== undefined ? { workerId: job.workerName } : {}),
    },
    job,
    fingerprint,
    ...(job.queueName !== undefined ? { tags: { queue: job.queueName } } : {}),
  };

  return await tracker.captureException(error, input);
}

export async function withJobErrorTracking<T>(
  tracker: ObserveErrorTracker,
  job: ErrorJobContext,
  fn: () => Promise<T>,
  options?: JobErrorTrackingOptions,
): Promise<T> {
  try {
    return await fn();
  } catch (error: unknown) {
    await captureJobError(tracker, error, job, options);
    throw error;
  }
}

export async function captureDatabaseError(
  tracker: ObserveErrorTracker,
  error: unknown,
  database: ErrorDatabaseContext,
): Promise<string | undefined> {
  const rawCode =
    typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  const code =
    database.errorCode ??
    (typeof rawCode === 'string' || typeof rawCode === 'number' ? rawCode : undefined);

  const sanitizedDb: ErrorDatabaseContext = {
    ...database,
    ...(code !== undefined ? { errorCode: code } : {}),
  };

  const fingerprint = [
    'db',
    database.system,
    database.operation ?? 'query',
    String(code ?? 'unknown'),
  ];

  return await tracker.captureException(error, {
    severity: 'error',
    handled: true,
    source: {
      component: `database.${database.system}`,
      ...(database.operation !== undefined ? { operation: database.operation } : {}),
    },
    database: sanitizedDb,
    fingerprint,
    tags: {
      'db.system': database.system,
      ...(database.operation !== undefined ? { 'db.operation': database.operation } : {}),
    },
  });
}

export async function withDatabaseErrorTracking<T>(
  tracker: ObserveErrorTracker,
  database: Omit<ErrorDatabaseContext, 'durationMs'>,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    return await fn();
  } catch (error: unknown) {
    await captureDatabaseError(tracker, error, {
      ...database,
      durationMs: Date.now() - start,
    });
    throw error;
  }
}
