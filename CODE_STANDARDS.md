# Coding Standards

Standards for the `nestjs-observe` monorepo (47 packages). Rules are enforced by TypeScript config, Oxlint, Prettier, and the architecture checker.

## TypeScript

- Base config: [`tsconfig.base.json`](tsconfig.base.json), `strict: true`.
- Key flags: `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`, `useUnknownInCatchVariables`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedModules`.
- Target: `ES2023`, module: `NodeNext`.
- Avoid `any`, unsafe assertions, and broad lint suppressions. In `src/`, `typescript/no-explicit-any` and `typescript/no-non-null-assertion` are errors.

## Linting and Formatting

- Lint: [Oxlint](.oxlintrc.json) (`pnpm run lint`, CI uses `pnpm run lint:ci -- --type-aware`).
- Format: Prettier (`pnpm run format:check` / `pnpm run format`).
- Important rules: `no-console: error` (except examples/scripts/benchmarks/tests), `unicorn/filename-case: kebabCase`, `import/no-cycle: warn`, `typescript/consistent-type-imports: error`, `no-unused-vars: error` with `^_` ignore patterns.

## Naming and File Conventions

- **Files/directories**: `kebab-case`.
- **Roles/suffixes** (use when applicable): `*.adapter.ts`, `*.bridge.ts`, `*-engine.ts`, `*.builder.ts`, `*.factory.ts`, `*.serializer.ts`, `*.normalizer.ts`, `*.transport.ts`, `*.formatter.ts`, `*.resolver.ts`, `*.exception.ts`, `*.module.ts`, `*.service.ts`, `*.spec.ts`.
- **Types/classes/interfaces/enums**: `PascalCase`; interfaces must not use an `I` prefix.
- **Exceptions**: `*Exception` suffix, extending the domain base exception where applicable.
- **Methods/variables/properties**: `camelCase`, verb-first methods; booleans prefer `is/has/can/should` prefixes.
- **Constants**: `UPPER_SNAKE_CASE` for module-level immutable constants.
- **Private members**: TypeScript `private`/`readonly`, not `_` prefixes.

## Architecture and Package Boundaries

- Each package under `packages/` is independently publishable: `publishConfig.access: "public"`, `exports["."]` defined, `files` is `["dist"]` or `["LICENSE","dist"]`, no `workspace:*` in runtime/peer/optional/dev deps.
- `scripts/check-architecture.mjs` enforces dependency boundaries, forbidden imports, optional-peer lazy loading, declared-dependency usage, and acyclic workspace dependencies. Run `pnpm run arch:check`.
- Domain isolation: logs, traces, metrics, and error-tracking domains do not cross-import each other; `@aldok10/nestjs-observe` composes them via optional peers.
- `@aldok10/nestjs-observe-core` is domain-neutral (no NestJS/OTel/sibling-observe/backend/framework runtime deps).

## NestJS Compatibility

- Support NestJS `^10.0.0 || ^11.0.0 || ^12.0.0` where applicable.
- Library source should keep decorator metadata compatible without requiring consumer `experimentalDecorators` (e.g. `Injectable()(Cls)`, `Module({})(Cls)`).
- Prefer constructor/factory injection and NestJS lifecycle hooks; do not manually instantiate Nest-managed providers in DI graphs.

## Testing

- Test files: `*.spec.ts` (and `*.spec.mjs` where used by repo tests).
- Organize by class/method: `describe('ClassName', () => { describe('methodName', () => { ... }) })`.
- Prefer typed table-driven cases (`it.each`) for variants and boundary conditions.
- Test public behavior, lifecycle cleanup, error propagation, and concurrency isolation.
- Use real temp dirs/loopback servers where appropriate; avoid external network in unit tests.

## Changes

- Add/update tests for behavior changes.
- Keep public exports ESM/CJS compatible; verify with build and consumer smoke tests when changing exports/deps.
- Use Changesets for publishable package changes (`pnpm changeset`).
