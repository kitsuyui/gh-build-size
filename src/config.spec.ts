import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

import { DEFAULT_COMMENT_TEMPLATE, normalizeConfig } from './config'

describe('normalizeConfig', () => {
  test('fills defaults', async () => {
    const config = await normalizeConfig(
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

  test('expands workspace package resolvers', async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'gh-build-size-config-'),
    )
    await fs.mkdir(path.join(workspaceRoot, 'packages', 'alpha'), {
      recursive: true,
    })
    await fs.mkdir(path.join(workspaceRoot, 'packages', 'beta'), {
      recursive: true,
    })
    await fs.writeFile(
      path.join(workspaceRoot, 'packages', 'alpha', 'package.json'),
      '{}\n',
    )
    await fs.writeFile(
      path.join(workspaceRoot, 'packages', 'beta', 'package.json'),
      '{}\n',
    )

    const config = await normalizeConfig(
      {
        resolvers: [
          {
            type: 'workspace-packages',
            root: 'packages',
            dist_dir: 'dist',
            include: ['**/*'],
          },
        ],
      },
      {
        githubToken: 'token',
        configPath: '.github/gh-build-size.yml',
        outputDir: '.gh-build-size',
      },
      workspaceRoot,
    )

    expect(config.targets.some((target) => target.id === 'pkg-alpha')).toBe(
      true,
    )
    expect(
      config.targets.some(
        (target) =>
          target.label === 'alpha' &&
          target.files.includes('packages/alpha/dist/**/*'),
      ),
    ).toBe(true)
  })
})
