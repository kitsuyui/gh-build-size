import { describe, expect, test } from 'vitest'

import { renderReportMarkdown } from './report'
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

describe('renderReportMarkdown', () => {
  test('renders a simple file size report', () => {
    const markdown = renderReportMarkdown(snapshot)
    expect(markdown).toContain('# gh-build-size report')
    expect(markdown).toContain('| `dist/index.mjs` | 120 B | 60 B | 55 B |')
    expect(markdown).toContain('- Repository: **kitsuyui/gh-build-size**')
  })
})
