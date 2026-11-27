import { createLoggerManager } from '@aldok10/nestjs-observe-logger-core';
import { WebhookTransport } from './webhook.transport.js';

const sent: unknown[] = [];
const transport = new WebhookTransport({
  send(payload) {
    sent.push(payload);
  },
});

const manager = createLoggerManager({
  channels: [{ name: 'app', transports: [transport] }],
});

manager.getLogger('app').info('order created', { metadata: { orderId: 'o-1' } });
await manager.flush();
await manager.shutdown();

if (sent.length !== 1) throw new Error(`expected 1 webhook payload, got ${sent.length}`);
console.log('custom-transport example: ok');
