import { describe, expect, test } from 'vitest'

import { renderReportMarkdown } from './report'
import type { FilesSnapshot } from './types'

const snapshot: FilesSnapshot = {
  schema_version: 1,
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
    expect(markdown).toContain(
      '| <code>dist/index.mjs</code> | 120 B | 60 B | 55 B |',
    )
    expect(markdown).toContain('- Repository: **kitsuyui/gh-build-size**')
    expect(markdown).not.toContain('Generated at')
  })

  test('escapes file paths before inserting them into markdown tables', () => {
    const markdown = renderReportMarkdown({
      ...snapshot,
      files: [
        {
          path: 'dist/with|pipe`tick<script>\nnext.mjs',
          sizes: null,
        },
      ],
    })

    expect(markdown).toContain(
      '| <code>dist/with&#124;pipe`tick&lt;script&gt; next.mjs</code> | N/A | N/A | N/A |',
    )
    expect(markdown).not.toContain('<script>')
    expect(markdown).not.toContain('with|pipe')
  })
})
