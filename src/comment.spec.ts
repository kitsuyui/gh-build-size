import { describe, expect, test } from 'vitest'

import { buildMarker, decideCommentAction, renderComment } from './comment'
import { DEFAULT_COMMENT_TEMPLATE } from './config'
import type { SummaryStatus } from './types'

const summary: SummaryStatus = {
  schema_version: 1,
  generated_at: '2026-04-12T00:00:00.000Z',
  repository: 'kitsuyui/gh-build-size',
  default_branch: 'main',
  publish_branch: null,
  event_name: 'pull_request',
  base_label: 'main',
  base_reference: 'base',
  head_label: '#1',
  head_reference: 'head',
  targets: [
    {
      id: 'web',
      label: 'web',
      files: ['dist/app.js'],
      touched_files: ['dist/app.js'],
      baseline_missing: false,
      commentable: true,
      sizes: {
        raw: { enabled: true, current: 120, base: 100, delta: 20 },
        gzip: { enabled: true, current: 60, base: 50, delta: 10 },
        brotli: { enabled: true, current: 55, base: 45, delta: 10 },
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
    },
  ],
}

describe('comment', () => {
  test('builds marker', () => {
    expect(buildMarker('default')).toBe('<!-- gh-build-size:default -->')
  })

  test('renders markdown table', () => {
    const body = renderComment(
      summary,
      DEFAULT_COMMENT_TEMPLATE,
      buildMarker('default'),
    )
    expect(body).toContain('| <code>web</code> | 100 B | 120 B | +20 B |')
    expect(body).toContain('120 B exceeds limit 100 B')
  })

  test('escapes target labels before inserting them into markdown tables', () => {
    const body = renderComment(
      {
        ...summary,
        targets: summary.targets.map((target) => ({
          ...target,
          label: 'web|<script>`x`\nnext',
        })),
      },
      DEFAULT_COMMENT_TEMPLATE,
      buildMarker('default'),
    )

    expect(body).toContain(
      '| <code>web&#124;&lt;script&gt;`x` next</code> | 100 B | 120 B | +20 B |',
    )
    expect(body).toContain(
      '- web&#124;&lt;script&gt;&#96;x&#96; next (raw): 120 B exceeds limit 100 B',
    )
    expect(body).not.toContain('<script>')
    expect(body).not.toContain('web|')
  })

  test('decides update action', () => {
    expect(
      decideCommentAction(
        { id: 1, body: 'old' },
        '<!-- gh-build-size:default -->\nnew',
      ),
    ).toEqual({
      type: 'update',
      commentId: 1,
      body: '<!-- gh-build-size:default -->\nnew',
    })
  })

  test('keeps first measurement comments concise', () => {
    const body = renderComment(
      {
        ...summary,
        targets: summary.targets.map((target) => ({
          ...target,
          baseline_missing: true,
          touched_files: [],
          sizes: {
            ...target.sizes,
            raw: { enabled: true, current: 120, base: null, delta: null },
            gzip: { enabled: true, current: 60, base: null, delta: null },
            brotli: { enabled: true, current: 55, base: null, delta: null },
          },
        })),
      },
      DEFAULT_COMMENT_TEMPLATE,
      buildMarker('default'),
    )
    expect(body).not.toContain('### Initial measurement')
    expect(body).toContain('| <code>web</code> | n&#x2F;a | 120 B | n&#x2F;a |')
  })

  test('exposes per-compression sizes in row template data', () => {
    const template = `{{{marker}}}
{{#rows}}
raw:{{sizes.raw.current}} gzip:{{sizes.gzip.current}} brotli:{{sizes.brotli.current}}
{{/rows}}`
    const body = renderComment(summary, template, buildMarker('default'))
    expect(body).toContain('raw:120 B gzip:60 B brotli:55 B')
  })

  test('renders compressed-only targets in the markdown table', () => {
    const body = renderComment(
      {
        ...summary,
        targets: summary.targets.map((target) => ({
          ...target,
          sizes: {
            raw: { enabled: false, current: 0, base: null, delta: null },
            gzip: { enabled: true, current: 60, base: 50, delta: 10 },
            brotli: { enabled: false, current: 0, base: null, delta: null },
          },
        })),
      },
      DEFAULT_COMMENT_TEMPLATE,
      buildMarker('default'),
    )
    expect(body).toContain('| <code>web</code> (gzip) | 50 B | 60 B | +10 B |')
  })
})
