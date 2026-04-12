import type { FilesSnapshot } from './types'

function formatBytes(value: number): string {
  return `${value.toLocaleString('en-US')} B`
}

export function renderReportMarkdown(snapshot: FilesSnapshot): string {
  const rows = snapshot.files
    .map(
      (file) =>
        `| \`${file.path}\` | ${formatBytes(file.sizes.raw)} | ${formatBytes(file.sizes.gzip)} | ${formatBytes(file.sizes.brotli)} |`,
    )
    .join('\n')

  return `# gh-build-size report

- Repository: **${snapshot.repository}**
- Head: \`${snapshot.head_reference}\`
- Generated at: ${snapshot.generated_at}

| File | Raw | Gzip | Brotli |
| --- | ---: | ---: | ---: |
${rows}
`
}
