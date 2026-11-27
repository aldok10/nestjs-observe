import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLoggerManager } from '@aldok10/nestjs-observe-logger-core';
import { ConsoleTransport, StreamTransport } from '@aldok10/nestjs-observe-logger-transports';

const dir = await mkdtemp(join(tmpdir(), 'cisea-logger-example-'));
const paths = {
  app: join(dir, 'app.log'),
  audit: join(dir, 'audit.log'),
};

const manager = createLoggerManager({
  channels: [
    {
      name: 'app',
      transports: [
        new StreamTransport({ path: paths.app, formatter: 'json' }),
        new ConsoleTransport({ formatter: 'text' }),
      ],
    },
    {
      name: 'audit',
      transports: [new StreamTransport({ path: paths.audit, formatter: 'json' })],
    },
  ],
  defaultChannel: 'app',
});

manager.getLogger().info('service started', { requestId: 'req-1' });
manager.getLogger('audit').warn('configuration changed', { metadata: { actor: 'demo' } });
manager.getLogger('app').log('service stopped');

await manager.shutdown();

const outputs = await Promise.all(
  Object.entries(paths).map(async ([name, path]) => {
    const text = await readFile(path, 'utf8');
    const lines = text.trim().split('\n');
    return `channel=${name} lines=${lines.length} file=${path}`;
  }),
);
for (const line of outputs) console.log(line);
