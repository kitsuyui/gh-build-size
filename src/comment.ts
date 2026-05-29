import Mustache from 'mustache'

import { renderMarkdownCodeCell, renderMarkdownText } from './markdown'
import type { Compression, SummaryStatus } from './types'

const commentCompressions: Compression[] = ['raw', 'gzip', 'brotli']

function formatBytes(value: number | null): string {
  if (value === null) {
    return 'n/a'
  }
  return `${value.toLocaleString('en-US')} B`
}

function formatDelta(value: number | null): string {
  if (value === null) {
    return 'n/a'
  }
  if (value === 0) {
    return '0 B'
  }
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toLocaleString('en-US')} B`
}

export function buildMarker(key: string): string {
  return `<!-- gh-build-size:${key} -->`
}

function selectCommentSize(target: SummaryStatus['targets'][number]): {
  compression: Compression
  size: SummaryStatus['targets'][number]['sizes'][Compression]
} | null {
  for (const compression of commentCompressions) {
    const size = target.sizes[compression]
    if (size.base !== null || size.current > 0) {
      return { compression, size }
    }
  }
  return null
}

export function renderComment(
  summary: SummaryStatus,
  template: string,
  marker: string,
): string {
  const rows = summary.targets
    .filter((target) => target.commentable)
    .flatMap((target) => {
      const selected = selectCommentSize(target)
      if (!selected) {
        return []
      }
      const compressionLabel =
        selected.compression === 'raw' ? '' : ` (${selected.compression})`
      return [
        {
          label: `${renderMarkdownCodeCell(target.label)}${compressionLabel}`,
          base: formatBytes(selected.size.base),
          current: formatBytes(selected.size.current),
          delta: formatDelta(selected.size.delta),
          sizes: {
            raw: {
              enabled: target.sizes.raw.enabled,
              base: formatBytes(target.sizes.raw.base),
              current: formatBytes(target.sizes.raw.current),
              delta: formatDelta(target.sizes.raw.delta),
            },
            gzip: {
              enabled: target.sizes.gzip.enabled,
              base: formatBytes(target.sizes.gzip.base),
              current: formatBytes(target.sizes.gzip.current),
              delta: formatDelta(target.sizes.gzip.delta),
            },
            brotli: {
              enabled: target.sizes.brotli.enabled,
              base: formatBytes(target.sizes.brotli.base),
              current: formatBytes(target.sizes.brotli.current),
              delta: formatDelta(target.sizes.brotli.delta),
            },
          },
        },
      ]
    })
  const violations = summary.targets.flatMap((target) =>
    target.violations.map((violation) => ({
      label: renderMarkdownText(target.label),
      compression: violation.compression,
      message: violation.message,
    })),
  )

  return Mustache.render(template, {
    marker,
    base_header: summary.base_label,
    head_header: summary.head_label,
    rows,
    violations,
    has_violations: violations.length > 0,
  })
}

export function decideCommentAction(
  existing: { id: number; body: string } | null,
  nextBody: string | null,
):
  | { type: 'create'; body: string }
  | { type: 'update'; commentId: number; body: string }
  | { type: 'delete'; commentId: number }
  | { type: 'skip' } {
  if (!existing && !nextBody) {
    return { type: 'skip' }
  }
  if (!existing && nextBody) {
    return { type: 'create', body: nextBody }
  }
  if (existing && !nextBody) {
    return { type: 'delete', commentId: existing.id }
  }
  if (existing && nextBody && existing.body !== nextBody) {
    return { type: 'update', commentId: existing.id, body: nextBody }
  }
  return { type: 'skip' }
}
