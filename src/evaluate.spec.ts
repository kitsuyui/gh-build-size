import { describe, expect, test } from 'vitest'

import { countFailingViolations, evaluateTargets } from './evaluate'
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

function createSnapshot(
  totals: TargetSnapshot['totals'],
  filePath = 'dist/app.js',
): TargetSnapshot {
  return {
    schema_version: 1,
    id: 'web',
    label: 'web',
    files: [
      {
        path: filePath,
        sizes: totals,
      },
    ],
    totals,
  }
}

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

  test('reports limit and no_increase violations and counts only failing ones', () => {
    const configWithBudgetRules: NormalizedConfig = {
      ...config,
      targets: [
        {
          ...config.targets[0],
          limits: {
            raw: {
              max_bytes: 100,
              fail: false,
            },
          },
          ratchet: {
            gzip: {
              no_increase: true,
              fail: true,
            },
          },
        },
      ],
    }

    const [target] = evaluateTargets(
      configWithBudgetRules,
      [createSnapshot({ raw: 120, gzip: 70, brotli: 55 })],
      [createSnapshot({ raw: 90, gzip: 60, brotli: 50 })],
      new Map([['web', ['dist/app.js']]]),
      new Set(['web']),
      true,
    )

    expect(target?.violations).toEqual([
      {
        compression: 'raw',
        kind: 'limit',
        message: '120 B exceeds limit 100 B',
        fail: false,
      },
      {
        compression: 'gzip',
        kind: 'no_increase',
        message: '70 B increased from 60 B',
        fail: true,
      },
    ])
    expect(target).toBeDefined()
    expect(countFailingViolations(target ? [target] : [])).toBe(1)
  })

  test('disables sizes for compressions not configured on the target', () => {
    const configWithRawOnly: NormalizedConfig = {
      ...config,
      targets: [
        {
          ...config.targets[0],
          compressions: ['raw'],
        },
      ],
    }

    const [target] = evaluateTargets(
      configWithRawOnly,
      currentSnapshots,
      baseSnapshots,
      new Map([['web', ['dist/app.js']]]),
      new Set(['web']),
      true,
    )

    expect(target?.sizes.raw).toEqual({
      enabled: true,
      current: 120,
      base: 0,
      delta: 120,
    })
    expect(target?.sizes.gzip).toEqual({
      enabled: false,
      current: 0,
      base: null,
      delta: null,
    })
    expect(target?.sizes.brotli).toEqual({
      enabled: false,
      current: 0,
      base: null,
      delta: null,
    })
  })
})
