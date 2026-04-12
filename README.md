# gh-build-size

[![Build Size Report](https://raw.githubusercontent.com/kitsuyui/gh-build-size/gh-build-size-assets/badges/total.svg)](https://github.com/kitsuyui/gh-build-size/blob/gh-build-size-assets/report.html)

`gh-build-size` is a GitHub Action for measuring built artifact sizes on pull
requests and on the default branch. It is designed to work without SaaS: the
action compares the current build against a Git baseline, posts a managed PR
comment, and can publish JSON plus SVG badges to a dedicated branch.

The first version focuses on repository-owned build outputs such as
`dist/**/*.js`, `dist/**/*.css`, `public/**/*.wasm`, or any other generated
files that are checked after a build step. It measures `raw`, `gzip`, and
`brotli` sizes per configured target.

## Quick start

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

The action reads `.github/gh-build-size.yml` by default.

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

For JavaScript monorepos, `gh-build-size` can also expand package targets
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

That configuration produces one target per workspace package such as
`bits128`, `cipher`, and `word-stats`, without listing every package manually.

## Behavior

- On pull requests, `gh-build-size` resolves a merge base, re-measures the base
  revision, and posts a single managed PR comment.
- When the publish branch does not have a baseline yet, `gh-build-size` treats
  the target as an initial measurement and still comments on the pull request.
- On pushes to the default branch, `gh-build-size` can publish `summary.json`,
  `files.json`, `report.html`, per-target JSON files, and SVG badges to a
  dedicated branch.
- Measurements are aggregated per target across all matched files.
- The durable record is file-level. PR comments and target summaries are just
  views over the recorded file snapshots.

## Published files

When publishing is enabled, the action writes these files to the publish
branch:

- `summary.json`
- `files.json`
- `report.html`
- `badges/<target>.svg`
- `targets/<target>.json`

`summary.json` is a compact summary for comments and quick inspection.
`files.json` and `targets/<target>.json` keep the original measured file names
plus size data, so later tools can regroup files differently or generate richer
HTML reports without rerunning old builds. `report.html` is the simplest built-in
view over the latest file-level snapshot.

## Dogfooding

This repository runs `gh-build-size` on itself. The workflow in
`.github/workflows/gh-build-size.yml` lints, tests, rebuilds `dist/`, and then
invokes the local action with `uses: ./`.

The default dogfooding config tracks both an aggregate target and narrower
targets:

- `total`: all committed `dist/` artifacts
- `runtime`: the shipped `.mjs` runtime bundle
- `sourcemaps`: generated `.map` files
- `types`: generated `.d.mts` files

That gives one top-level "total dist" signal alongside more focused targets for
reviewing regressions.

## Standard CI

This repository also includes a small standard CI set modeled after
`gh-counter`:

- `.github/workflows/test.yml`: lint, test, and build on pull requests and on
  `main`
- `.github/workflows/octocov.yml`: publish coverage and code-to-test ratio with
  `octocov`
- `.github/workflows/spellcheck.yml`: run `typos` on pull requests

## Notes

- Run the build step before `gh-build-size`.
- Use `fetch-depth: 0` so the action can resolve a stable merge base.
- This repository is intended to commit built `dist/` files for the action
  runtime, similar to other JavaScript actions.
