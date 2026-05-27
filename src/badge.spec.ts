import { describe, expect, test } from 'vitest'

import { renderBadge } from './badge'
import type { TargetStatus } from './types'

const target: TargetStatus = {
  id: 'web',
  label: 'web',
  files: ['dist/app.js'],
  touched_files: ['dist/app.js'],
  baseline_missing: false,
  commentable: true,
  sizes: {
    raw: { enabled: true, current: 120, base: 100, delta: 20 },
    gzip: { enabled: true, current: 60, base: 50, delta: 10 },
    brotli: { enabled: true, current: 55, base: 45, delta: 10 },
  },
  violations: [],
  badge_path: '',
  target_path: '',
}

describe('renderBadge', () => {
  test('renders svg using selected compression', () => {
    const svg = renderBadge(target, { compression: 'gzip' })
    expect(svg).toContain('web (gzip)')
    expect(svg).toContain('60 B')
  })

  test('renders N/A when selected compression is disabled', () => {
    const disabledTarget: TargetStatus = {
      ...target,
      sizes: {
        raw: { enabled: true, current: 120, base: 100, delta: 20 },
        gzip: { enabled: false, current: 0, base: null, delta: null },
        brotli: { enabled: false, current: 0, base: null, delta: null },
      },
    }
    const svg = renderBadge(disabledTarget, { compression: 'gzip' })
    expect(svg).toContain('web (gzip)')
    expect(svg).toContain('N/A')
    expect(svg).not.toContain('0 B')
  })

  test('renders configured hex badge colors', () => {
    const svg = renderBadge(target, { colors: { ok: '#abc' } })

    expect(svg).toContain('fill="#abc"')
  })

  test('falls back instead of embedding invalid badge colors', () => {
    const svg = renderBadge(target, {
      colors: { ok: '" onclick="alert(1)' },
    })

    expect(svg).toContain('fill="#2ea44f"')
    expect(svg).not.toContain('onclick')
    expect(svg).not.toContain('&quot;')
  })
})
