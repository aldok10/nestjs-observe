import { ShutdownException } from '../exceptions/index.js';
import { BoundedExecution } from './bounded-execution.js';
import type { ComponentHealth, LifecycleParticipant } from './lifecycle.contracts.js';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class LifecycleCoordinator {
  private readonly participants: LifecycleParticipant[] = [];
  private readonly boundedExecution = new BoundedExecution();
  private shutdownInFlight: Promise<void> | undefined;

  register(...participants: readonly LifecycleParticipant[]): void {
    for (const participant of participants) {
      if (!this.participants.includes(participant)) {
        this.participants.push(participant);
      }
    }
  }

  async initializeAll(): Promise<void> {
    await this.initializeSequence(0, []);
  }

  async flush(timeoutMs?: number): Promise<void> {
    const jobs = this.participants.map(async (participant) => {
      if (participant.flush !== undefined) await participant.flush(timeoutMs);
    });
    try {
      await this.boundedExecution.run(
        Promise.allSettled(jobs).then(() => undefined),
        timeoutMs,
      );
    } catch {
      // Bounded flush: stop waiting on timeout without throwing.
    }
  }

  shutdown(timeoutMs?: number): Promise<void> {
    if (this.shutdownInFlight !== undefined) return this.shutdownInFlight;
    this.shutdownInFlight = this.teardown(timeoutMs);
    return this.shutdownInFlight;
  }

  get shutdownPromise(): Promise<void> | undefined {
    return this.shutdownInFlight;
  }

  health(): Promise<readonly ComponentHealth[]> {
    return Promise.all(
      this.participants.map(async (participant): Promise<ComponentHealth> => {
        if (participant.health !== undefined) return await participant.health();
        return { name: participant.name, state: 'healthy' };
      }),
    );
  }

  private async initializeSequence(
    index: number,
    initialized: LifecycleParticipant[],
  ): Promise<void> {
    const participant = this.participants[index];
    if (participant === undefined) return;
    if (participant.initialize !== undefined) {
      try {
        await participant.initialize();
        initialized.push(participant);
      } catch (error: unknown) {
        await this.shutdownParticipants(initialized.toReversed(), undefined);
        throw error;
      }
    }
    await this.initializeSequence(index + 1, initialized);
  }

  private async teardown(timeoutMs?: number): Promise<void> {
    await this.flush(timeoutMs);
    await this.shutdownParticipants(this.participants.toReversed(), timeoutMs);
  }

  private async shutdownParticipants(
    targets: readonly LifecycleParticipant[],
    timeoutMs?: number,
  ): Promise<void> {
    if (targets.length === 0) return;
    const jobs = targets.map((participant) => participant.shutdown(timeoutMs));
    let results: readonly PromiseSettledResult<void>[] = [];
    try {
      results = await this.boundedExecution.run(Promise.allSettled(jobs), timeoutMs);
    } catch {
      // Bounded shutdown: stop waiting rather than hanging.
    }
    const failures = results.flatMap((result, index) =>
      result.status === 'rejected'
        ? [`${targets[index]?.name ?? 'participant'}: ${errorMessage(result.reason)}`]
        : [],
    );
    if (failures.length > 0) throw new ShutdownException(failures);
  }
}
