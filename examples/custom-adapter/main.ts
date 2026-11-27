import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  OBSERVE_LOGGER,
  ObserveLoggerModule,
  type UniversalLogger,
} from '@aldok10/nestjs-observe-logger';
import { JsonLinesLoggerAdapter, type LineSink } from './json-lines-logger.adapter.js';

const lines: string[] = [];
const sink: LineSink = { write: (line: string) => lines.push(line.trim()) };

@Module({
  imports: [
    ObserveLoggerModule.forRoot({
      // Factory registration: the adapter comes from user code, core is untouched.
      adapters: [{ name: 'json-lines', useFactory: () => new JsonLinesLoggerAdapter(sink) }],
      defaultAdapter: 'json-lines',
      level: 'info',
      context: { metadata: { service: 'custom-adapter-example' } },
    }),
  ],
})
class AppModule {}

const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
const logger = app.get<UniversalLogger>(OBSERVE_LOGGER);
logger.debug('filtered out by level');
logger.info?.('order created', { requestId: 'req-42' });
logger.error('payment failed', { requestId: 'req-43' });
await app.close();

for (const line of lines) console.log(line);
const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
const messages = events.filter((event) => 'message' in event).map((event) => event['message']);
if (JSON.stringify(messages) !== JSON.stringify(['order created', 'payment failed'])) {
  throw new Error(`unexpected messages: ${JSON.stringify(messages)}`);
}
if (
  !events.some((event) => event['event'] === 'adapter.initialize') ||
  !events.some((event) => event['event'] === 'adapter.dispose')
) {
  throw new Error('adapter lifecycle hooks did not run');
}
console.log('custom-adapter example: ok');
