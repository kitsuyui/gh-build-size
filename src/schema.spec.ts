import { describe, expect, test } from 'vitest'

import {
  normalizePublishedFilesSnapshot,
  normalizePublishedSummary,
  normalizePublishedTargetSnapshot,
} from './schema'

const targetStatus = {
  id: 'web',
  label: 'web',
  files: ['dist/app.js'],
  touched_files: ['dist/app.js'],
  baseline_missing: false,
  commentable: true,
  sizes: {
    raw: { current: 120, base: 100, delta: 20 },
    gzip: { current: 60, base: 50, delta: 10 },
    brotli: { current: 55, base: 45, delta: 10 },
  },
  violations: [
    {
      compression: 'raw',
      kind: 'limit',
      message: '120 B exceeds limit 100 B',
      fail: true,
    },
  ],
  badge_path: '.gh-build-size/badges/web.svg',
  target_path: '.gh-build-size/targets/web.json',
}

const fileSnapshot = {
  path: 'dist/app.js',
  sizes: {
    raw: 120,
    gzip: 60,
    brotli: 55,
  },
}

describe('published schema validation', () => {
  test('normalizes legacy summaries without schema_version as v1', () => {
    const summary = normalizePublishedSummary({
      generated_at: '2026-04-12T00:00:00.000Z',
      repository: 'kitsuyui/gh-build-size',
      default_branch: 'main',
      publish_branch: null,
      event_name: 'pull_request',
      base_label: 'main',
      base_reference: 'base',
      head_label: '#1',
      head_reference: 'head',
      targets: [targetStatus],
    })

    expect(summary?.schema_version).toBe(1)
    expect(summary?.targets[0]?.id).toBe('web')
    expect(summary?.targets[0]?.sizes.raw.enabled).toBe(true)
  })

  test('accepts published summaries without generated_at', () => {
    const summary = normalizePublishedSummary({
      schema_version: 1,
      repository: 'kitsuyui/gh-build-size',
      default_branch: 'main',
      publish_branch: null,
      event_name: 'pull_request',
      base_label: 'main',
      base_reference: 'base',
      head_label: '#1',
      head_reference: 'head',
      targets: [targetStatus],
    })

    expect(summary?.generated_at).toBeUndefined()
    expect(summary?.targets[0]?.id).toBe('web')
  })

  test('rejects unsupported published summary schema versions', () => {
    expect(
      normalizePublishedSummary({
        schema_version: 2,
        generated_at: '2026-04-12T00:00:00.000Z',
        repository: 'kitsuyui/gh-build-size',
        default_branch: 'main',
        publish_branch: null,
        event_name: 'pull_request',
        base_label: 'main',
        base_reference: 'base',
        head_label: '#1',
        head_reference: 'head',
        targets: [targetStatus],
      }),
    ).toBeNull()
  })

  test('rejects published summaries with targets missing sizes field', () => {
    expect(
      normalizePublishedSummary({
        schema_version: 1,
        repository: 'kitsuyui/gh-build-size',
        default_branch: 'main',
        publish_branch: null,
        event_name: 'push',
        base_label: 'main',
        base_reference: null,
        head_label: 'main',
        head_reference: 'head',
        targets: [
          {
            id: 'web',
            label: 'web',
            files: ['dist/app.js'],
            touched_files: [],
            baseline_missing: false,
            commentable: true,
            // sizes intentionally missing to simulate old publish branch data
            violations: [],
            badge_path: 'badges/web.svg',
            target_path: 'targets/web.json',
          },
        ],
      }),
    ).toBeNull()
  })

  test('rejects published summaries with targets that have sizes in legacy numeric format', () => {
    expect(
      normalizePublishedSummary({
        schema_version: 1,
        repository: 'kitsuyui/gh-build-size',
        default_branch: 'main',
        publish_branch: null,
        event_name: 'push',
        base_label: 'main',
        base_reference: null,
        head_label: 'main',
        head_reference: 'head',
        targets: [
          {
            id: 'web',
            label: 'web',
            files: ['dist/app.js'],
            touched_files: [],
            baseline_missing: false,
            commentable: true,
            // legacy format: sizes as plain numbers instead of SizeValueStatus objects
            sizes: { raw: 120, gzip: 60, brotli: 55 },
            violations: [],
            badge_path: 'badges/web.svg',
            target_path: 'targets/web.json',
          },
        ],
      }),
    ).toBeNull()
  })

  test('validates published files and target snapshots', () => {
    expect(
      normalizePublishedFilesSnapshot({
        repository: 'kitsuyui/gh-build-size',
        default_branch: 'main',
        publish_branch: 'gh-build-size-assets',
        event_name: 'push',
        head_reference: 'head',
        files: [fileSnapshot],
      })?.schema_version,
    ).toBe(1)
    expect(
      normalizePublishedTargetSnapshot({
        id: 'web',
        label: 'web',
        files: [fileSnapshot],
        totals: {
          raw: 120,
          gzip: 60,
          brotli: 55,
        },
      })?.schema_version,
    ).toBe(1)
  })
})
