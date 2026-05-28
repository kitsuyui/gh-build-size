function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function normalizeInlineText(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/\n/g, ' ')
}

export function renderMarkdownCodeCell(value: string): string {
  return `<code>${escapeHtml(normalizeInlineText(value)).replace(/\|/g, '&#124;')}</code>`
}

export function renderMarkdownText(value: string): string {
  return escapeHtml(normalizeInlineText(value))
    .replace(/\|/g, '&#124;')
    .replace(/`/g, '&#96;')
}
