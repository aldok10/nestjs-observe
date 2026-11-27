import type { LogRecord, LogTransport, TransportHealth } from '@aldok10/nestjs-observe-logger-core';

export interface WebhookSink {
  send(payload: unknown): Promise<void> | void;
}

/**
 * Example custom transport: sends redacted log records to a webhook sink.
 * The transport owns no external connection; close/flush are no-ops here.
 */
export class WebhookTransport implements LogTransport {
  readonly name = 'webhook';
  private sent = 0;
  private failed = 0;
  private lastError: string | undefined;

  constructor(private readonly sink: WebhookSink) {}

  async write(record: LogRecord): Promise<void> {
    try {
      await this.sink.send({
        timestamp: record.timestamp,
        level: record.level,
        message: record.message,
        context: record.context,
        requestId: record.requestId,
        metadata: record.metadata,
      });
      this.sent += 1;
    } catch (error) {
      this.failed += 1;
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  health(): TransportHealth {
    const healthy = this.failed === 0;
    return {
      name: this.name,
      status: healthy ? 'healthy' : 'degraded',
      healthy,
      queued: 0,
      capacity: 0,
      dropped: 0,
      sent: this.sent,
      failed: this.failed,
      ...(this.lastError !== undefined ? { lastError: this.lastError } : {}),
    };
  }

  async flush(): Promise<void> {}
  async close(): Promise<void> {}
}
