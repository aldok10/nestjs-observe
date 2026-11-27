import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import type { LogRecord } from '@aldok10/nestjs-observe-logger-core/contracts';
import { OptionalPeerMissingException } from '@aldok10/nestjs-observe-logger-core/exceptions';
import { loadOptionalPeer } from './optional-peer.loader.js';
import { StreamTransport } from './stream.transport.js';

const directories: string[] = [];

afterEach(() => {
  while (directories.length > 0) {
    const dir = directories.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

function createRecord(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    schemaVersion: 1,
    timestamp: 1_700_000_000_000,
    level: 'info',
    message: 'hello',
    ...overrides,
  };
}

describe('StreamTransport', () => {
  it('expands {pid} and appends formatted records', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cisea-stream-'));
    directories.push(dir);
    const path = join(dir, 'application-{pid}.log');
    const transport = new StreamTransport({ path, formatter: 'json' });
    await transport.write(createRecord({ message: 'one' }));
    await transport.write(createRecord({ message: 'two' }));
    await transport.close();

    expect(readdirSync(dir)).toContain(`application-${process.pid}.log`);
    const filePath = join(dir, `application-${process.pid}.log`);
    expect(statSync(filePath).mode & 0o777).toBe(0o600);
    const lines = readFileSync(filePath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)['message']).toBe('one');
    expect(JSON.parse(lines[1]!)['message']).toBe('two');
  });

  it('rotates through the installed rotating-file-stream', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cisea-rotate-'));
    directories.push(dir);
    const transport = new StreamTransport({
      path: join(dir, 'rotating-{pid}.log'),
      rotation: { size: '1B', maxFiles: 3, compress: false },
    });
    await transport.write(createRecord({ message: 'one' }));
    await transport.write(createRecord({ message: 'two' }));
    await transport.write(createRecord({ message: 'three' }));
    await transport.close();

    const files = readdirSync(dir);
    expect(files.some((file) => file.includes(`rotating-${process.pid}`))).toBe(true);
    expect(files.length).toBeGreaterThan(1);
  });

  it('creates missing parent directories automatically for file paths', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cisea-mkdir-'));
    directories.push(dir);
    const nestedPath = join(dir, 'nested', 'deep', 'app.log');
    const transport = new StreamTransport({ path: nestedPath, formatter: 'json' });
    await transport.write(createRecord({ message: 'nested' }));
    await transport.close();

    expect(existsSync(nestedPath)).toBe(true);
    expect(readFileSync(nestedPath, 'utf8')).toContain('"message":"nested"');
  });

  it('writes to a custom Writable stream without closing external streams by default', async () => {
    const stream = new PassThrough();
    const chunks: string[] = [];
    stream.on('data', (chunk: Buffer | string) => chunks.push(chunk.toString('utf8')));

    const transport = new StreamTransport({
      stream,
      formatter: { format: (record) => record.message },
    });
    await transport.write(createRecord({ message: 'via-writable' }));
    await transport.close();

    expect(stream.writableEnded).toBe(false);
    expect(chunks.join('')).toContain('via-writable');

    const owned = new PassThrough();
    const ownedTransport = new StreamTransport({ stream: owned, closeStream: true });
    await ownedTransport.write(createRecord({ message: 'owned' }));
    await ownedTransport.close();
    expect(owned.writableEnded).toBe(true);
  });

  it('throws OptionalPeerMissingException for missing optional peers', () => {
    expect(() => loadOptionalPeer('missing-optional-peer-pkg', 'file rotation')).toThrow(
      OptionalPeerMissingException,
    );
    expect(() => loadOptionalPeer('missing-optional-peer-pkg', 'file rotation')).toThrow(
      /Optional peer dependency "missing-optional-peer-pkg" is required for file rotation/,
    );
  });
});
