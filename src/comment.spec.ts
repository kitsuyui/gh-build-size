import { describe, expect, test } from 'vitest'

import { buildMarker, decideCommentAction, renderComment } from './comment'
import { DEFAULT_COMMENT_TEMPLATE } from './config'
import type { SummaryStatus } from './types'

const summary: SummaryStatus = {
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
    expect(body).toContain('| `web` | raw | 100 B | 120 B | +20 B |')
    expect(body).toContain('120 B exceeds limit 100 B')
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
})
