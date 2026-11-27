import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { AppService } from './app.service.js';

const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
app.get(AppService).run();
await app.close();
