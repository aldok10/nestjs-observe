# Contributing to `@aldok10/nestjs-observe`

Follow [CODE_STANDARDS.md](CODE_STANDARDS.md) for all changes.

## Workspace

- Node.js `>= 22`
- pnpm workspace (`pnpm-workspace.yaml`, `packageManager` in root `package.json`)
- Packages live under `packages/*`

## Local Workflow

1. Install dependencies:

   ```sh
   pnpm install
   ```

2. Run quality gates before opening a PR:

   ```sh
   pnpm run lint
   pnpm run format:check
   pnpm run typecheck
   pnpm test
   pnpm run build
   pnpm run arch:check
   ```

3. Run consumer install smoke when changing package exports/deps:

   ```sh
   pnpm run test:consumer
   ```

4. Run examples/benchmarks when modifying channels, transports, formatters, or NestJS DI:

   ```sh
   node examples/standalone/index.mjs
   node benchmarks/log-throughput.mjs
   ```

## Package Conventions

- New files use `kebab-case` with explicit role suffixes (`*.adapter.ts`, `*.transport.ts`, `*.formatter.ts`, `*.exception.ts`, `*.spec.ts`).
- Keep boundaries clear: core contracts/runtime, NestJS integration, backend adapters, transports, testing helpers.
- Avoid `any`, unsafe assertions, and broad lint suppressions.
- Add/update tests for behavior changes. Unit tests use `*.spec.ts`; prefer table-driven cases for variants.
- Public package exports must resolve in ESM and CJS; verify with build and consumer smoke tests.

## Changesets

Use Changesets for publishable package changes:

```sh
pnpm changeset
```
