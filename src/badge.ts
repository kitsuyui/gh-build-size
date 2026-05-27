import type { BadgeConfig, TargetStatus } from './types'

const DEFAULT_COLORS = {
  ok: '2ea44f',
  warn: 'dbab09',
  error: 'cf222e',
} as const

const HEX_COLOR_PATTERN = /^#?(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/

type BadgeColorName = keyof typeof DEFAULT_COLORS

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

function pickBadgeColor(name: BadgeColorName, badge?: BadgeConfig): string {
  const color = badge?.colors?.[name]?.trim()
  if (color && HEX_COLOR_PATTERN.test(color)) {
    return `#${color.replace(/^#/, '')}`
  }
  return `#${DEFAULT_COLORS[name]}`
}

function pickColor(target: TargetStatus, badge?: BadgeConfig): string {
  if (target.violations.some((violation) => violation.fail)) {
    return pickBadgeColor('error', badge)
  }
  const compression = pickCompression(target, badge)
  const sizeStatus = target.sizes[compression]
  if (!sizeStatus.enabled) {
    return pickBadgeColor('ok', badge)
  }
  const current = sizeStatus.current
  if (
    badge?.thresholds?.error_above !== undefined &&
    current >= badge.thresholds.error_above
  ) {
    return pickBadgeColor('error', badge)
  }
  if (
    badge?.thresholds?.warn_above !== undefined &&
    current >= badge.thresholds.warn_above
  ) {
    return pickBadgeColor('warn', badge)
  }
  return pickBadgeColor('ok', badge)
}

export function renderBadge(target: TargetStatus, badge?: BadgeConfig): string {
  const compression = pickCompression(target, badge)
  const label = badge?.label ?? `${target.label} (${compression})`
  const sizeStatus = target.sizes[compression]
  const value = sizeStatus.enabled
    ? `${sizeStatus.current.toLocaleString('en-US')} B`
    : 'N/A'
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
