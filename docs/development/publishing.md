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

### Stable (main/master)

[`.github/workflows/release.yml`](../../.github/workflows/release.yml) runs on pushes to `main` or `master` and manual `workflow_dispatch`:

1. Checks out the branch, sets up `pnpm@10.11.0` and Node `22` with `https://registry.npmjs.org`.
2. Runs `pnpm install --frozen-lockfile`.
3. If pending `.changeset/*.md` files exist (excluding `README.md`), runs `pnpm changeset version`, commits `chore(release): version packages [skip ci]`, builds, runs `pnpm changeset publish` to npm, publishes the same package versions to GitHub Packages (`npm.pkg.github.com`), pushes commit and tags, then creates GitHub Releases for new tags.
4. If no pending changesets exist, exits without publishing.

The workflow uses the `npm` GitHub environment, `GITHUB_TOKEN`, and `NPM_TOKEN` with `contents: write`, `id-token: write`, and `packages: write` permissions. npm publish uses `NPM_TOKEN` with provenance attestation; GitHub Packages publish uses `GITHUB_TOKEN`. Each MR merged to main/master creates a stable release only when it includes a changeset.

### Dev (dev)

[`.github/workflows/dev-release.yml`](../../.github/workflows/dev-release.yml) runs on pushes to `dev` and manual `workflow_dispatch`:

1. Checks out `dev`, sets up `pnpm@10.11.0` and Node `22`.
2. If pending `.changeset/*.md` files exist, builds, creates snapshot versions (`changeset version --snapshot dev`), publishes snapshot packages to npm with tag `dev`, and publishes the same snapshots to GitHub Packages.
3. Creates an annotated git tag `dev-<YYYYMMDD-HHMMSS>-<shortsha>`, pushes it, and creates a GitHub prerelease.

Snapshot publish hanya jalan saat ada changeset pending; tag/pre-release dev tetap dibuat tiap push ke `dev`.

## Manual Release Command

The root `release` script in [package.json](../../package.json) chains the full local gate before publishing:

```sh
pnpm run release
```

This executes `pnpm build && pnpm test && pnpm run lint && pnpm run typecheck && pnpm changeset publish`.
