import { renderMarkdownCodeCell } from './markdown'
import type { FilesSnapshot } from './types'

function formatBytes(value: number): string {
  return `${value.toLocaleString('en-US')} B`
}

export function renderReportMarkdown(snapshot: FilesSnapshot): string {
  const rows = snapshot.files
    .map((file) => {
      const path = renderMarkdownCodeCell(file.path)
      return file.sizes
        ? `| ${path} | ${formatBytes(file.sizes.raw)} | ${formatBytes(file.sizes.gzip)} | ${formatBytes(file.sizes.brotli)} |`
        : `| ${path} | N/A | N/A | N/A |`
    })
    .join('\n')

  return `# gh-build-size report

- Repository: **${snapshot.repository}**
- Head: \`${snapshot.head_reference}\`

| File | Raw | Gzip | Brotli |
| --- | ---: | ---: | ---: |
${rows}
`
}
