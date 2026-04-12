import { describe, expect, test } from 'vitest'

import { renderBadge } from './badge'
import type { TargetStatus } from './types'

const target: TargetStatus = {
  id: 'web',
  label: 'web',
  files: ['dist/app.js'],
  touched_files: ['dist/app.js'],
  commentable: true,
  sizes: {
    raw: { current: 120, base: 100, delta: 20 },
    gzip: { current: 60, base: 50, delta: 10 },
    brotli: { current: 55, base: 45, delta: 10 },
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
})
