import type { FilesSnapshot } from './types'

function formatBytes(value: number): string {
  return `${value.toLocaleString('en-US')} B`
}

export function renderReportMarkdown(snapshot: FilesSnapshot): string {
  const rows = snapshot.files
    .map((file) =>
      file.sizes
        ? `| \`${file.path}\` | ${formatBytes(file.sizes.raw)} | ${formatBytes(file.sizes.gzip)} | ${formatBytes(file.sizes.brotli)} |`
        : `| \`${file.path}\` | N/A | N/A | N/A |`,
    )
    .join('\n')

  return `# gh-build-size report

- Repository: **${snapshot.repository}**
- Head: \`${snapshot.head_reference}\`

| File | Raw | Gzip | Brotli |
| --- | ---: | ---: | ---: |
${rows}
`
}
