import type {
  LogRecord,
  LogTransport,
  TransportHealth,
} from '@aldok10/nestjs-observe-logger-core/contracts';

export class CaptureTransport implements LogTransport {
  readonly records: LogRecord[] = [];
  readonly name: string;

  constructor(name = 'capture') {
    this.name = name;
  }

  write(record: LogRecord): void {
    this.records.push(record);
  }

  async flush(): Promise<void> {}

  health(): TransportHealth {
    return {
      name: this.name,
      status: 'healthy',
      healthy: true,
      queued: 0,
      capacity: 0,
      dropped: 0,
      sent: this.records.length,
      failed: 0,
    };
  }

  async close(): Promise<void> {}
}
