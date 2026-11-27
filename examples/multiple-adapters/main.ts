import 'reflect-metadata';
import { Writable } from 'node:stream';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import pino from 'pino';
import winston from 'winston';
import {
  LOGGER_MANAGER,
  OBSERVE_LOGGER,
  ObserveLoggerModule,
  type ChannelLogger,
  type LoggerManager,
} from '@aldok10/nestjs-observe-logger';
import { createLoggerToken as createChannelLoggerToken } from '@aldok10/nestjs-observe-logger/channels';
import { PinoLoggerAdapter } from '@aldok10/nestjs-observe-logger-adapter-pino';
import { WinstonLoggerAdapter } from '@aldok10/nestjs-observe-logger-adapter-winston';

const pinoLines: string[] = [];
const winstonLines: string[] = [];

const pinoLogger = pino({ level: 'info' }, { write: (line: string) => pinoLines.push(line) });
const winstonLogger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Stream({
      stream: new Writable({
        write(chunk: Buffer, _encoding, callback): void {
          winstonLines.push(chunk.toString('utf8'));
          callback();
        },
      }),
    }),
  ],
});

@Module({
  imports: [
    ObserveLoggerModule.forRoot({
      // Explicit class registration; each backend lives in its own optional package.
      adapters: [PinoLoggerAdapter, WinstonLoggerAdapter],
      channels: {
        app: { default: true, backend: { type: 'pino', logger: pinoLogger } },
        payments: { backend: { type: 'winston', logger: winstonLogger } },
      },
    }),
  ],
})
class AppModule {}

const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
app.get<ChannelLogger>(OBSERVE_LOGGER).info('app channel via pino', { requestId: 'req-1' });
app.get<ChannelLogger>(createChannelLoggerToken('payments')).warn('payments channel via winston');
await app.get<LoggerManager>(LOGGER_MANAGER).flush();
await app.close();

console.log(`pino lines=${pinoLines.length}: ${pinoLines.join('').trim()}`);
console.log(`winston lines=${winstonLines.length}: ${winstonLines.join('').trim()}`);
if (pinoLines.length !== 1 || winstonLines.length !== 1) {
  throw new Error('each channel must deliver exactly one line to its own backend');
}
console.log('multiple-adapters example: ok');
