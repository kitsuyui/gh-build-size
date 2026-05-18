import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

import { DEFAULT_COMMENT_TEMPLATE, loadConfig, normalizeConfig } from './config'

describe('normalizeConfig', () => {
  test('loads config schema version 1', async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'gh-build-size-config-version-'),
    )
    const configPath = path.join(workspaceRoot, 'gh-build-size.yml')
    await fs.writeFile(
      configPath,
      [
        'version: 1',
        'targets:',
        '  - id: web',
        '    files:',
        '      - dist/**/*.js',
        '',
      ].join('\n'),
    )

    await expect(loadConfig(configPath)).resolves.toMatchObject({
      version: 1,
    })
  })

  test('rejects unsupported config schema versions', async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'gh-build-size-config-version-'),
    )
    const configPath = path.join(workspaceRoot, 'gh-build-size.yml')
    await fs.writeFile(
      configPath,
      [
        'version: 2',
        'targets:',
        '  - id: web',
        '    files:',
        '      - dist/**/*.js',
        '',
      ].join('\n'),
    )

    await expect(loadConfig(configPath)).rejects.toThrow('Invalid config')
  })

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
    await fs.mkdir(path.join(workspaceRoot, 'packages', '@scope', 'gamma'), {
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
    await fs.writeFile(
      path.join(workspaceRoot, 'packages', '@scope', 'gamma', 'package.json'),
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
    expect(
      config.targets.some(
        (target) =>
          target.id === 'pkg-gamma' &&
          target.files.includes('packages/@scope/gamma/dist/**/*'),
      ),
    ).toBe(true)
  })

  test('throws on duplicate target IDs caused by slugification collision', async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'gh-build-size-config-collision-'),
    )
    await fs.mkdir(path.join(workspaceRoot, 'packages', 'my-package'), {
      recursive: true,
    })
    await fs.mkdir(path.join(workspaceRoot, 'packages', 'my.package'), {
      recursive: true,
    })
    await fs.writeFile(
      path.join(workspaceRoot, 'packages', 'my-package', 'package.json'),
      '{}\n',
    )
    await fs.writeFile(
      path.join(workspaceRoot, 'packages', 'my.package', 'package.json'),
      '{}\n',
    )

    await expect(
      normalizeConfig(
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
      ),
    ).rejects.toThrow('Duplicate target IDs detected')
  })

  test('throws on duplicate target IDs from explicit targets', async () => {
    await expect(
      normalizeConfig(
        {
          targets: [
            { id: 'web', files: ['dist/**/*.js'] },
            { id: 'web', files: ['build/**/*.js'] },
          ],
        },
        {
          githubToken: 'token',
          configPath: '.github/gh-build-size.yml',
          outputDir: '.gh-build-size',
        },
      ),
    ).rejects.toThrow('Duplicate target IDs detected')
  })
})
