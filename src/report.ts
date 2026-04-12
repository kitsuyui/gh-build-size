import type { FilesSnapshot } from './types'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatBytes(value: number): string {
  return `${value.toLocaleString('en-US')} B`
}

export function renderReportHtml(snapshot: FilesSnapshot): string {
  const rows = snapshot.files
    .map(
      (file) => `
        <tr>
          <td><code>${escapeHtml(file.path)}</code></td>
          <td>${formatBytes(file.sizes.raw)}</td>
          <td>${formatBytes(file.sizes.gzip)}</td>
          <td>${formatBytes(file.sizes.brotli)}</td>
        </tr>`,
    )
    .join('\n')

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>gh-build-size report</title>
    <style>
      :root {
        color-scheme: light;
        font-family: ui-sans-serif, system-ui, sans-serif;
      }
      body {
        margin: 0;
        padding: 2rem;
        background: #f7f7f5;
        color: #1f2328;
      }
      main {
        max-width: 72rem;
        margin: 0 auto;
      }
      h1 {
        margin: 0 0 0.5rem;
        font-size: 2rem;
      }
      .meta {
        margin-bottom: 1.5rem;
        color: #57606a;
      }
      p {
        margin: 0.25rem 0;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        background: #ffffff;
      }
      th, td {
        padding: 0.75rem;
        border-bottom: 1px solid #d1d9e0;
        text-align: left;
      }
      th {
        background: #f0f3f6;
      }
      td:nth-child(n + 2), th:nth-child(n + 2) {
        text-align: right;
        white-space: nowrap;
      }
      code {
        font-family: ui-monospace, SFMono-Regular, monospace;
        font-size: 0.9rem;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>gh-build-size report</h1>
      <div class="meta">
        <p>Repository: <strong>${escapeHtml(snapshot.repository)}</strong></p>
        <p>Head: <code>${escapeHtml(snapshot.head_reference)}</code></p>
        <p>Generated at: ${escapeHtml(snapshot.generated_at)}</p>
      </div>
      <table>
        <thead>
          <tr>
            <th>File</th>
            <th>Raw</th>
            <th>Gzip</th>
            <th>Brotli</th>
          </tr>
        </thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </main>
  </body>
</html>
`
}
