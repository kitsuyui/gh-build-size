import Mustache from 'mustache'

import type { SummaryStatus } from './types'

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

export function renderComment(
  summary: SummaryStatus,
  template: string,
  marker: string,
): string {
  const rows = summary.targets
    .filter((target) => target.commentable)
    .filter(
      (target) =>
        target.sizes.raw.base !== null || target.sizes.raw.current > 0,
    )
    .map((target) => ({
      label: `\`${target.label}\``,
      base: formatBytes(target.sizes.raw.base),
      current: formatBytes(target.sizes.raw.current),
      delta: formatDelta(target.sizes.raw.delta),
    }))
  const violations = summary.targets.flatMap((target) =>
    target.violations.map((violation) => ({
      label: target.label,
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
