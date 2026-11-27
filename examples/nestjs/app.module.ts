import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { ObserveLoggerModule } from '@aldok10/nestjs-observe-logger';
import { ConsoleTransport } from '@aldok10/nestjs-observe-logger-transports/console';
import { AppService } from './app.service.js';

@Module({
  imports: [
    ObserveLoggerModule.forRoot({
      channels: {
        main: { default: true, transports: [new ConsoleTransport()] },
        audit: { transports: [new ConsoleTransport()] },
      },
    }),
  ],
  providers: [AppService],
})
export class AppModule {}
