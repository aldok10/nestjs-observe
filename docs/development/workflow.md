# Development Workflow

## Environment Requirements

- **Node.js**: `>=22` (defined in [package.json](../../package.json))
- **Package manager**: `pnpm@10.11.0` (`packageManager` in [package.json](../../package.json))

Install all workspace dependencies from the repository root:

```sh
pnpm install
```

## Workspace Scripts

All scripts are defined in the root [package.json](../../package.json):

| Script                   | Command                                                     | Purpose                                                    |
| ------------------------ | ----------------------------------------------------------- | ---------------------------------------------------------- |
| `pnpm run build`         | `pnpm -r --workspace-concurrency=4 run build`               | Build all workspace packages (`tsup` ESM, CJS, `.d.ts`).   |
| `pnpm test`              | `vitest run`                                                | Run unit and integration tests with Vitest.                |
| `pnpm run test:coverage` | `vitest run --coverage`                                     | Run Vitest with V8 coverage (`@vitest/coverage-v8`).       |
| `pnpm run lint`          | `oxlint`                                                    | Run Oxlint across the workspace.                           |
| `pnpm run lint:fix`      | `oxlint --fix`                                              | Auto-fix Oxlint issues where supported.                    |
| `pnpm run lint:strict`   | `oxlint --deny-warnings`                                    | Fail on any Oxlint warning.                                |
| `pnpm run lint:ci`       | `oxlint --deny-warnings`                                    | CI lint entrypoint (invoked with `-- --type-aware` in CI). |
| `pnpm run format`        | `prettier --write .`                                        | Format files with Prettier.                                |
| `pnpm run format:check`  | `prettier --check .`                                        | Verify Prettier formatting without modifying files.        |
| `pnpm run typecheck`     | `pnpm -r --if-present run typecheck`                        | Run TypeScript typechecking across packages.               |
| `pnpm run arch:check`    | `node scripts/check-architecture.mjs`                       | Verify package dependency boundaries and naming rules.     |
| `pnpm run lint:arch`     | `node scripts/check-architecture.mjs`                       | Alias for `arch:check`.                                    |
| `pnpm run quality`       | `npm run lint && npm run format:check && npm run typecheck` | Run lint, format check, and typecheck together.            |
| `pnpm run test:consumer` | `node scripts/test-consumer-install.mjs`                    | Pack tarballs and verify ESM/CJS consumer installs.        |
| `pnpm run bench`         | `node benchmarks/log-throughput.mjs`                        | Run the in-process log throughput microbenchmark.          |

Run targeted Vitest suites by passing a package path:

```sh
pnpm exec vitest run packages/observer/observer
```

## Quality Gates & Standards

### TypeScript & Oxlint

Workspace packages enforce strict TypeScript settings in `tsconfig.json` (including `strict`, `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, and `useUnknownInCatchVariables`) alongside Oxlint rules in `.oxlintrc.json`:

- `typescript/no-explicit-any: error`
- `typescript/consistent-type-imports: error`
- `typescript/no-non-null-assertion: error` (in `src/`)
- `no-unused-vars: error` (`^_`)
- `no-console: error` (outside `examples/`, `scripts/`, and `benchmarks/`)
- `unicorn/filename-case: kebabCase`

See [CODE_STANDARDS.md](../../CODE_STANDARDS.md) for the full list of compiler and lint rules.

### Package & Naming Conventions

From [CODE_STANDARDS.md](../../CODE_STANDARDS.md) and [CONTRIBUTING.md](../../CONTRIBUTING.md):

- **File naming**: `kebab-case` with explicit role suffixes (`*.adapter.ts`, `*.bridge.ts`, `*-engine.ts`, `*.builder.ts`, `*.factory.ts`, `*.serializer.ts`, `*.normalizer.ts`, `*.transport.ts`, `*.formatter.ts`, `*.resolver.ts`, `*.exception.ts`, `*.module.ts`, `*.service.ts`, `*.spec.ts`).
- **Symbols**: `PascalCase` classes/interfaces/types without `I`-prefixes; `*Exception` classes extending `LoggerException`; `camelCase` verb-first methods and `is`/`has`/`can`/`should` boolean prefixes; TypeScript `private` instead of `_` prefixes.
- **NestJS compatibility**: Decorator metadata in library source is applied functionally (`Injectable()(Cls)`, `Module({})(Cls)`) so consumers do not require `experimentalDecorators`.
- **Testing**: `*.spec.ts` files organized by `describe('ClassName', () => { describe('methodName', () => { ... }) })` with typed `CASES` arrays and `it.each(CASES)` for variants.

### Architecture Boundaries (`arch:check`)

`scripts/check-architecture.mjs` enforces isolation between packages:

- `@aldok10/nestjs-observe-core` cannot import `@nestjs/*`, `@opentelemetry/*`, `@aldok10/*`, logging backends (`pino`, `winston`, `bunyan`, `log4js`), or HTTP frameworks (`express`, `fastify`).
- `@aldok10/nestjs-observe-logger-core` and its subpackages (`delivery`, `context`, `filtering`, `formatters`, `redaction`, `transports`) cannot import `@nestjs/*`, `@opentelemetry/*`, backends, HTTP frameworks, or logger adapters.
- Logger, tracing, metrics, and error-tracking domains cannot cross-import each other; only `@aldok10/nestjs-observe` composes them.

## CI Matrix

[CI](../../.github/workflows/ci.yml) runs on every `push`, `pull_request`, and `workflow_dispatch`:

- **`matrix-test`**: Runs across a 6-cell matrix:
  - **Node.js**: `22`, `24`
  - **NestJS**: `10`, `11`, `12`
  - **Steps**: `pnpm install --frozen-lockfile` → `pnpm run lint:ci -- --type-aware` → `pnpm run lint:arch` → `pnpm run format:check` → `pnpm run typecheck` → `pnpm test` → `pnpm run build` → `pnpm run publish:dry-run`.
- **`audit`**: Runs on Node `22` with `pnpm install --prod --frozen-lockfile` and fails if `pnpm audit --prod --json` reports any production vulnerability (`total !== 0`).
- **`ci-status`**: Aggregates `matrix-test` and `audit` and fails if any job failed, was cancelled, or was skipped.
