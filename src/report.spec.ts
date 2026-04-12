import { describe, expect, test } from 'vitest'

import { renderReportHtml } from './report'
import type { FilesSnapshot } from './types'

const snapshot: FilesSnapshot = {
  generated_at: '2026-04-12T00:00:00.000Z',
  repository: 'kitsuyui/gh-build-size',
  default_branch: 'main',
  publish_branch: 'gh-build-size-assets',
  event_name: 'push',
  head_reference: 'abc123',
  files: [
    {
      path: 'dist/index.mjs',
      sizes: {
        raw: 120,
        gzip: 60,
        brotli: 55,
      },
    },
  ],
}

describe('renderReportHtml', () => {
  test('renders a simple file size report', () => {
    const html = renderReportHtml(snapshot)
    expect(html).toContain('<title>gh-build-size report</title>')
    expect(html).toContain('<code>dist/index.mjs</code>')
    expect(html).toContain('120 B')
    expect(html).toContain('60 B')
    expect(html).toContain('55 B')
  })
})
