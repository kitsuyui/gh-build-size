import { describe, expect, test } from 'vitest'

import { evaluateTargets } from './evaluate'
import type { NormalizedConfig, TargetSnapshot } from './types'

const config: NormalizedConfig = {
  defaultBranch: 'main',
  comment: {
    enabled: true,
    key: 'default',
    template: 'template',
  },
  publish: {
    enabled: true,
    branch: 'gh-build-size',
    directory: '.',
    summary_filename: 'summary.json',
    files_filename: 'files.json',
    report_filename: 'report.html',
    badges_directory: 'badges',
    targets_directory: 'targets',
  },
  targets: [
    {
      id: 'web',
      label: 'web',
      files: ['dist/**/*.js'],
      compressions: ['raw', 'gzip', 'brotli'],
      max_file_bytes: 64 * 1024 * 1024,
    },
  ],
}

const currentSnapshots: TargetSnapshot[] = [
  {
    schema_version: 1,
    id: 'web',
    label: 'web',
    files: [
      {
        path: 'dist/app.js',
        sizes: {
          raw: 120,
          gzip: 60,
          brotli: 55,
        },
      },
    ],
    totals: {
      raw: 120,
      gzip: 60,
      brotli: 55,
    },
  },
]

const baseSnapshots: TargetSnapshot[] = [
  {
    schema_version: 1,
    id: 'web',
    label: 'web',
    files: [],
    totals: {
      raw: 0,
      gzip: 0,
      brotli: 0,
    },
  },
]

describe('evaluateTargets', () => {
  test('marks a target commentable on first measurement without touched files', () => {
    const [target] = evaluateTargets(
      config,
      currentSnapshots,
      baseSnapshots,
      new Map(),
      new Set(),
      true,
    )

    expect(target?.baseline_missing).toBe(true)
    expect(target?.commentable).toBe(true)
  })

  test('keeps untouched target non-commentable when a published baseline exists', () => {
    const [target] = evaluateTargets(
      config,
      currentSnapshots,
      baseSnapshots,
      new Map(),
      new Set(['web']),
      true,
    )

    expect(target?.baseline_missing).toBe(false)
    expect(target?.commentable).toBe(false)
  })

  test('marks baseline_missing for push event when target absent from published summary', () => {
    const [target] = evaluateTargets(
      config,
      currentSnapshots,
      baseSnapshots,
      new Map(),
      new Set(),
      false,
    )

    expect(target?.baseline_missing).toBe(true)
    expect(target?.commentable).toBe(true)
  })

  test('does not mark baseline_missing for push event when target present in published summary', () => {
    const [target] = evaluateTargets(
      config,
      currentSnapshots,
      baseSnapshots,
      new Map(),
      new Set(['web']),
      false,
    )

    expect(target?.baseline_missing).toBe(false)
    expect(target?.commentable).toBe(true)
  })

  test('does not mark baseline_missing when publishedTargetIds is null (no published summary)', () => {
    const [target] = evaluateTargets(
      config,
      currentSnapshots,
      baseSnapshots,
      new Map(),
      null,
      false,
    )

    expect(target?.baseline_missing).toBe(false)
    expect(target?.commentable).toBe(true)
  })
})
