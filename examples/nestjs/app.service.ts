import { Injectable } from '@nestjs/common';
import type { ChannelLogger } from '@aldok10/nestjs-observe-logger';
import { InjectLogger } from '@aldok10/nestjs-observe-logger';

@Injectable()
export class AppService {
  constructor(
    @InjectLogger('main') private readonly main: ChannelLogger,
    @InjectLogger('audit') private readonly audit: ChannelLogger,
  ) {}

  run(): void {
    this.main.info('nest example started');
    this.audit.warn('sample audit event', { metadata: { actor: 'demo' } });
  }
}
