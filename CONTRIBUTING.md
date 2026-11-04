# Contributing to neocord

Read [ARCHITECTURE.md](./ARCHITECTURE.md) first. It is the contract between the packages.

## Setup

You need [Bun](https://bun.com) 1.4 or newer and Node.js 22.22 or newer.

```bash
bun install
bun run build
```

## Everyday commands

| Command | What it does |
| --- | --- |
| `bun run build` | Builds every package and app through Turbo |
| `bun run typecheck` | Type checks everything |
| `bun run test` | Runs every test suite |
| `bun run lint` | Lints the packages and the example bot |
| `bun run check:packages` | Validates the published shape of each package |
| `bun run e2e` | Packs the real tarballs, scaffolds projects and runs them end to end |

## Conventions

- Source code has no comments. Prefer clear names and small functions.
- Relative imports include their `.ts` or `.tsx` extension.
- Published code must run on Node and Bun, so `Bun.*` and `bun:*` are only for tests and repo scripts.
- Shared dependency versions go in the catalog in the root `package.json`.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).

## Releasing

Every user-facing change needs a changeset:

```bash
bun run changeset
```

All published packages share one version. When changesets land on `main`, the release workflow opens a version pull request. Merging it publishes to npm with `bun publish`, which resolves `workspace:` and `catalog:` versions.

The workflow needs an `NPM_TOKEN` repository secret with publish rights to the `@teamneo` scope and the `neocord` and `create-neocord` package names.

## TypeScript 7

`tsc` here is native TypeScript 7, installed as `@typescript/native`. The `typescript` package name points at `@typescript/typescript6` because typescript-eslint needs the TS 6 API. Remove the alias once typescript-eslint supports TS 7.
