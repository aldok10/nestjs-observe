/* eslint-disable no-await-in-loop -- Sequential emits are the measured workload. */
import { existsSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST_ENTRYPOINTS = [
  'packages/logs/core/dist/index.js',
  'packages/logs/formatters/dist/json.js',
];
const ITERATIONS_DEFAULT = 100_000;
const ROUNDS = 3;
const WARMUP = 10_000;
const CAVEAT =
  'In-process microbenchmark on this machine; not a production SLA. No remote/network measurement. Results vary with hardware, GC and background load. JsonLogFormatter runs inside the in-memory transport; LogPipeline does not use its format option.';

function integerArg(name, fallback) {
  const arg = process.argv.slice(2).find((value) => value.startsWith(`--${name}=`));
  if (arg === undefined) return fallback;
  const value = Number(arg.slice(name.length + 3));
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`invalid --${name}: ${arg}`);
  return value;
}

function percentile(sorted, ratio) {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

async function main() {
  const args = process.argv.slice(2);
  const known = (value) => value === '--json' || value.startsWith('--iterations=');
  const unknown = args.find((value) => !known(value));
  if (unknown !== undefined) throw new Error(`unknown argument: ${unknown}`);
  const iterations = integerArg('iterations', ITERATIONS_DEFAULT);
  const jsonOnly = args.includes('--json');

  const missing = DIST_ENTRYPOINTS.filter((entry) => !existsSync(join(root, entry)));
  if (missing.length > 0) {
    throw new Error(`missing built dist: ${missing.join(', ')}. Run "pnpm run build" first.`);
  }

  const { LogPipeline } = await import('../packages/logs/core/dist/index.js');
  const { jsonFormatter } = await import('../packages/logs/formatters/dist/json.js');

  let records = 0;
  let bytes = 0;
  let lastLine = '';
  const pipeline = new LogPipeline({
    transports: [
      {
        name: 'memory',
        write(record) {
          const line = jsonFormatter.format(record);
          if (typeof line !== 'string') throw new Error('formatter returned no string');
          records += 1;
          bytes += line.length;
          lastLine = line;
        },
      },
    ],
  });

  const makeRecord = (index) => ({
    schemaVersion: 1,
    timestamp: 1_700_000_000_000 + index,
    level: 'info',
    message: `benchmark log line ${index}`,
    context: 'bench',
    requestId: `req-${index}`,
    metadata: { password: 'secret-value', userId: index, nested: { ok: true } },
  });

  const emit = async (record) => {
    const start = process.hrtime.bigint();
    await pipeline.emit(record);
    return Number(process.hrtime.bigint() - start);
  };

  for (let i = 0; i < WARMUP; i += 1) await emit(makeRecord(i));
  if (!lastLine.includes('[REDACTED]') || lastLine.includes('secret-value')) {
    throw new Error('redaction did not run before formatting');
  }

  const latencies = [];
  const rates = [];
  for (let round = 0; round < ROUNDS; round += 1) {
    const start = performance.now();
    for (let i = 0; i < iterations; i += 1) latencies.push(await emit(makeRecord(i)));
    const elapsedMs = performance.now() - start;
    rates.push((iterations * 1000) / elapsedMs);
  }
  if (rates.length !== ROUNDS || rates.some((rate) => !Number.isFinite(rate) || rate <= 0)) {
    throw new Error('no measurements');
  }

  const health = pipeline.health()[0];
  const expected = WARMUP + iterations * ROUNDS;
  if (records !== expected || health?.sent !== expected || health.failed !== 0) {
    throw new Error(
      `transport mismatch: wrote=${records} sent=${health?.sent} failed=${health?.failed}`,
    );
  }
  await pipeline.close();

  const sortedRates = rates.toSorted((a, b) => a - b);
  const medianOpsPerSec = sortedRates[Math.floor(sortedRates.length / 2)];
  const sortedLatencies = latencies.toSorted((a, b) => a - b);
  const result = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    cpu: cpus()[0]?.model ?? 'unknown',
    iterations,
    rounds: ROUNDS,
    warmup: WARMUP,
    workload:
      'LogPipeline (redaction in emit) -> in-memory transport calling JsonLogFormatter.format',
    opsPerSecByRound: rates.map((rate) => Math.round(rate)),
    medianOpsPerSec: Math.round(medianOpsPerSec),
    latencyNs: {
      p50: percentile(sortedLatencies, 0.5),
      p95: percentile(sortedLatencies, 0.95),
      p99: percentile(sortedLatencies, 0.99),
    },
    checksum: { records, bytes },
    commands: {
      build: 'pnpm run build',
      benchmark: 'node benchmarks/log-throughput.mjs',
      baseline: 'node benchmarks/log-throughput.mjs --json > benchmarks/baseline.json',
    },
    caveat: CAVEAT,
  };

  if (jsonOnly) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(
    `in-process pipeline benchmark: ${iterations} records x ${ROUNDS} rounds, ${WARMUP} warmup`,
  );
  console.log(`node -v: ${result.node}`);
  console.log(`platform: ${result.platform}; cpu: ${result.cpu}`);
  console.log(result.workload);
  console.log(
    `ops/sec by round: ${result.opsPerSecByRound.map((rate) => rate.toLocaleString('en-US')).join(', ')}`,
  );
  console.log(`median: ${result.medianOpsPerSec.toLocaleString('en-US')} ops/sec`);
  console.log(
    `latency per emit (all rounds): p50 ${result.latencyNs.p50.toLocaleString('en-US')} ns, p95 ${result.latencyNs.p95.toLocaleString('en-US')} ns, p99 ${result.latencyNs.p99.toLocaleString('en-US')} ns`,
  );
  console.log(`checksum: records=${records}, bytes=${bytes}, failed writes=${health.failed}`);
  console.log(result.caveat);
}

try {
  await main();
} catch (error) {
  console.error(
    `ERROR: benchmark failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
