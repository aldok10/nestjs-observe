# Publishing & Releases

This repository uses [Changesets](https://github.com/changesets/changesets) for independent package versioning and npm publishing.

## Versioning Configuration

[`.changeset/config.json`](../../.changeset/config.json) configures:

- **`fixed`**: `[]` (packages are versioned independently)
- **`linked`**: `[]`
- **`access`**: `"public"`
- **`baseBranch`**: `"main"`
- **`updateInternalDependencies`**: `"patch"` (bumping an internal dependency bumps dependent workspace packages by at least a patch)
- **`commit`**: `false`

## Creating a Changeset

When making a change to any publishable package under `packages/`, generate a changeset file:

```sh
pnpm changeset
```

Select the affected packages, choose the semver bump (`patch`, `minor`, or `major`), and describe the change. Commit the generated `.changeset/*.md` file with your PR.

To preview version bumps locally without publishing:

```sh
pnpm run version-packages
```

## Pre-Release Validation

Before releasing or changing package `exports`, `files`, or dependencies, run the local packaging checks from [package.json](../../package.json):

1. Build all packages:

   ```sh
   pnpm run build
   ```

2. Verify tarball contents without writing to npm (`npm pack --dry-run` per package):

   ```sh
   pnpm run pack:dry-run
   ```

3. Verify workspace publish resolution without publishing:

   ```sh
   pnpm run publish:dry-run
   ```

4. Run the isolated consumer installation smoke test:

   ```sh
   pnpm run test:consumer
   ```

   [`scripts/test-consumer-install.mjs`](../../scripts/test-consumer-install.mjs) packs workspace packages into tarballs, verifies that packed `package.json` manifests contain no `workspace:` ranges and no `src/` or `*.spec.ts` files, installs them into temporary consumer directories without workspace symlinks, and verifies standalone independence plus ESM/CJS imports.

## Automated Release Workflow

[`.github/workflows/release.yml`](../../.github/workflows/release.yml) runs on pushes to `main` and manual `workflow_dispatch`:

1. Checks out `main`, sets up `pnpm@10.11.0` and Node `22` with `https://registry.npmjs.org`.
2. Runs `pnpm install --frozen-lockfile` and `pnpm run build`.
3. Runs `changesets/action@v1` with:
   - `version: pnpm changeset version` (opens or updates a `chore(release): version packages` PR when `.changeset/*.md` files exist)
   - `publish: pnpm changeset publish` (publishes updated packages to npm with `NPM_CONFIG_PROVENANCE: true` once the release PR is merged)

The workflow uses the `npm` GitHub environment, `GITHUB_TOKEN`, and `NPM_TOKEN` with `id-token: write` permission for npm provenance attestation.

## Manual Release Command

The root `release` script in [package.json](../../package.json) chains the full local gate before publishing:

```sh
pnpm run release
```

This executes `pnpm build && pnpm test && pnpm run lint && pnpm run typecheck && pnpm changeset publish`.
