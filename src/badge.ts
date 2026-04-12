import type { BadgeConfig, TargetStatus } from './types'

const DEFAULT_COLORS = {
  ok: '2ea44f',
  warn: 'dbab09',
  error: 'cf222e',
} as const

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function pickCompression(_target: TargetStatus, badge?: BadgeConfig) {
  return badge?.compression ?? 'raw'
}

function pickColor(target: TargetStatus, badge?: BadgeConfig): string {
  const colors = {
    ...DEFAULT_COLORS,
    ...badge?.colors,
  }
  const compression = pickCompression(target, badge)
  const current = target.sizes[compression].current
  if (target.violations.some((violation) => violation.fail)) {
    return `#${colors.error.replace(/^#/, '')}`
  }
  if (
    badge?.thresholds?.error_above !== undefined &&
    current >= badge.thresholds.error_above
  ) {
    return `#${colors.error.replace(/^#/, '')}`
  }
  if (
    badge?.thresholds?.warn_above !== undefined &&
    current >= badge.thresholds.warn_above
  ) {
    return `#${colors.warn.replace(/^#/, '')}`
  }
  return `#${colors.ok.replace(/^#/, '')}`
}

export function renderBadge(target: TargetStatus, badge?: BadgeConfig): string {
  const compression = pickCompression(target, badge)
  const label = badge?.label ?? `${target.label} (${compression})`
  const value = `${target.sizes[compression].current.toLocaleString('en-US')} B`
  const escapedLabel = escapeXml(label)
  const escapedValue = escapeXml(value)
  const color = pickColor(target, badge)
  const leftWidth = Math.max(70, 14 + label.length * 7)
  const rightWidth = Math.max(60, 14 + value.length * 7)
  const totalWidth = leftWidth + rightWidth
  const rightCenter = leftWidth + rightWidth / 2

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${escapedLabel}: ${escapedValue}">
<title>${escapedLabel}: ${escapedValue}</title>
<linearGradient id="smooth" x2="0" y2="100%">
<stop offset="0" stop-color="#fff" stop-opacity=".7"/>
<stop offset=".1" stop-color="#aaa" stop-opacity=".1"/>
<stop offset=".9" stop-opacity=".3"/>
<stop offset="1" stop-opacity=".5"/>
</linearGradient>
<clipPath id="round"><rect width="${totalWidth}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#round)">
<rect width="${leftWidth}" height="20" fill="#555"/>
<rect x="${leftWidth}" width="${rightWidth}" height="20" fill="${color}"/>
<rect width="${totalWidth}" height="20" fill="url(#smooth)"/>
</g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${leftWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${escapedLabel}</text>
<text x="${leftWidth / 2}" y="14">${escapedLabel}</text>
<text x="${rightCenter}" y="15" fill="#010101" fill-opacity=".3">${escapedValue}</text>
<text x="${rightCenter}" y="14">${escapedValue}</text>
</g>
</svg>
`
}
