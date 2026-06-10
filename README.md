# gh-build-size

[![Build Size Report](https://raw.githubusercontent.com/kitsuyui/gh-build-size/gh-build-size-assets/badges/total.svg)](https://github.com/kitsuyui/gh-build-size/blob/gh-build-size-assets/report.md)

`gh-build-size` is a GitHub Action that measures the size of your built
artifacts and reports regressions in pull requests and on your default branch.

Use it when you want to:

- see whether a pull request makes your built output larger or smaller
- fail CI when a bundle exceeds a size limit
- keep a published record of the latest measured sizes without relying on SaaS

It works well for outputs such as `dist/**/*.js`, `dist/**/*.css`,
`public/**/*.wasm`, or any other generated files that exist after your build
step.

## What you get

After your build runs, `gh-build-size` can:

- compare the current build against a Git baseline
- post one managed comment on the pull request
- publish `summary.json`, `files.json`, `report.md`, per-target JSON, and SVG
  badges to a dedicated branch
- enforce size budgets and ratchets such as "do not increase gzip size"

It measures `raw`, `gzip`, and `brotli` sizes per target.

## Quick start

Add the action to a workflow that already builds your project:

```yaml
name: gh-build-size

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: write
  pull-requests: write

jobs:
  build-size:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0

      - run: npm ci
      - run: npm run build

      - uses: kitsuyui/gh-build-size@v0
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

Then add `.github/gh-build-size.yml`:

```yaml
version: 1
comment:
  enabled: true
publish:
  enabled: true
  branch: gh-build-size-assets
targets:
  - id: web
    label: Web bundle
    files:
      - dist/**/*.js
      - dist/**/*.css
    compressions: [raw, gzip, brotli]
    limits:
      gzip:
        max_bytes: 180000
        fail: true
    ratchet:
      gzip:
        no_increase: true
        fail: true
    badge:
      compression: gzip
```

That setup gives you:

- a pull request comment showing the size delta for the `web` target
- a failing workflow if gzip size goes above `180000` bytes
- a published badge and report on `gh-build-size-assets`

## Action inputs

The action accepts these workflow inputs:

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `github-token` | Yes | | GitHub token used for pull request comments and branch publishing |
| `config-path` | No | `.github/gh-build-size.yml` | Path to the gh-build-size YAML or JSON config file |
| `default-branch` | No | Repository default branch, otherwise `main` | Override the repository default branch |
| `publish-branch` | No | Configured `publish.branch`, otherwise `gh-build-size` | Override the publish branch configured in the file |
| `comment-key` | No | Configured `comment.key`, otherwise `default` | Override the HTML marker key used for idempotent pull request comments |
| `output-dir` | No | `.gh-build-size` | Directory used to write generated summary, file snapshot, report, target JSON, and badges |

## How it behaves

On pull requests:

- it resolves a merge base
- rebuilds the base revision for comparison
- posts or updates one managed pull request comment

On pushes to the default branch:

- it writes the latest measurement outputs to the publish branch
- it updates badges and `report.md` for the newest baseline

If there is no previously published baseline yet, `gh-build-size` still treats
the run as an initial measurement and can comment on the pull request.

## Configuration model

The configuration `version` field is currently `1`. Future incompatible
configuration changes can use that field for explicit migration or rejection
instead of silently interpreting unknown versions as the current schema.

Each target represents one reported unit such as a bundle, package, or artifact
group.

Useful target fields:

- `files`: glob patterns to include in the target
- `exclude`: files to ignore from that target
- `compressions`: any of `raw`, `gzip`, `brotli`
- `max_file_bytes`: maximum bytes to read from each matched file (default: `67108864`)
- `limits`: absolute size thresholds (`max_bytes` is in bytes)
- `ratchet`: relative rules such as `no_increase`
- `badge`: how to render the published SVG badge; `badge.thresholds.warn_above`
  and `badge.thresholds.error_above` are in bytes, matching `limits.max_bytes`

The durable record is file-level data. Pull request comments, target summaries,
and badges are views generated from those measured file snapshots.

## JavaScript Monorepos

For JavaScript monorepos, `gh-build-size` can expand package targets
automatically:

```yaml
version: 1
publish:
  enabled: true
  branch: gh-build-size-assets
targets:
  - id: total
    label: Total package artifacts
    files:
      - packages/*/dist/**
resolvers:
  - type: workspace-packages
    root: packages
    dist_dir: dist
    include:
      - "**/*"
    badge:
      compression: gzip
```

That configuration produces one target per workspace package without listing
every package manually, while still keeping one aggregate `total` target.

## Published files

When publishing is enabled, the action writes these files to the publish
branch:

- `summary.json`
- `files.json`
- `report.md`
- `badges/<target>.svg`
- `targets/<target>.json`

`summary.json` is the compact view for quick inspection. `files.json` and
`targets/<target>.json` preserve measured file names plus size data so later
tools can regroup or re-render the snapshot without rerunning an old build.
Each JSON file includes `schema_version` so future readers can reject or migrate
older published data intentionally.

## Action outputs

The action sets these step outputs after it runs:

| Output | Type | Description |
| --- | --- | --- |
| `summary-path` | `string` | Path to the generated summary JSON file |
| `summary-json` | `string` | The generated summary JSON (serialised) |
| `files-path` | `string` | Path to the generated files snapshot JSON |
| `report-path` | `string` | Path to the generated report Markdown |
| `violation-count` | `string` | Number of target/compression pairs that violated a failing condition |
| `has-violations` | `string` | `"true"` if any failing condition was violated, `"false"` otherwise |
| `publish-branch` | `string` | The publish branch used for generated assets (`""` when publishing is disabled) |

Example — upload the report as an artifact:

```yaml
- uses: kitsuyui/gh-build-size@v0
  id: size
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}

- uses: actions/upload-artifact@v4
  with:
    name: build-size-report
    path: ${{ steps.size.outputs.report-path }}
```

## Requirements

- run your build step before `gh-build-size`
- use `fetch-depth: 0` so the action can resolve a stable merge base
- commit built `dist/` files if your GitHub Action runtime depends on them

## Dogfooding

This repository runs `gh-build-size` on itself. The workflow in
`.github/workflows/gh-build-size.yml` lints, tests, rebuilds `dist/`, and then
invokes the local action with `uses: ./`.

The default dogfooding config tracks:

- `total`: all committed `dist/` artifacts
- `runtime`: the shipped `.mjs` runtime bundle
- `sourcemaps`: generated `.map` files
- `types`: generated `.d.mts` files

## Standard CI

This repository also includes a small standard CI set:

- `.github/workflows/test.yml`: lint, test, and build on pull requests and on
  `main`
- `.github/workflows/octocov.yml`: publish coverage and code-to-test ratio with
  `octocov`
- `.github/workflows/spellcheck.yml`: run `typos` on pull requests

## Development

This repository uses [lefthook](https://github.com/evilmartians/lefthook) to
run the same checks locally that CI runs in the cloud, giving you faster
feedback before pushing.

### Setup

```sh
lefthook install
```

### Hooks

**pre-commit** runs:

- `bun run lint` — Biome static analysis and formatting check

**pre-push** runs:

- `bun run lint` — Biome static analysis and formatting check
- `bun run test` — Vitest unit tests with coverage

CI still runs the full suite (lint, test, and build) on every pull request and
push to `main`. The local hooks bring that feedback earlier so you catch issues
before they reach CI.
