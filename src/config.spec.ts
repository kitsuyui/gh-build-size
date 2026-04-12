import { describe, expect, test } from 'vitest'

import { DEFAULT_COMMENT_TEMPLATE, normalizeConfig } from './config'

describe('normalizeConfig', () => {
  test('fills defaults', () => {
    const config = normalizeConfig(
      {
        targets: [{ id: 'web', files: ['dist/**/*.js'] }],
      },
      {
        githubToken: 'token',
        configPath: '.github/gh-build-size.yml',
        outputDir: '.gh-build-size',
      },
    )

    expect(config.comment.template).toBe(DEFAULT_COMMENT_TEMPLATE)
    expect(config.publish.branch).toBe('gh-build-size')
    expect(config.targets[0]?.compressions).toEqual(['raw', 'gzip', 'brotli'])
    expect(config.targets[0]?.label).toBe('web')
  })
})
