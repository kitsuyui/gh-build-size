import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

import { measureWorkspaceTargets } from './measure'

const tempDirs: string[] = []

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true })
    }
  }
})

describe('measureWorkspaceTargets', () => {
  test('measures configured files', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gh-build-size-'))
    tempDirs.push(dir)
    await fs.mkdir(path.join(dir, 'dist'), { recursive: true })
    await fs.writeFile(
      path.join(dir, 'dist', 'app.js'),
      'console.log("hello")\n',
    )
    const previousCwd = process.cwd()
    process.chdir(dir)

    try {
      const snapshots = await measureWorkspaceTargets([
        {
          id: 'web',
          label: 'web',
          files: ['dist/**/*.js'],
          compressions: ['raw', 'gzip', 'brotli'],
        },
      ])
      expect(snapshots[0]?.files).toEqual([
        {
          path: 'dist/app.js',
          sizes: {
            raw: expect.any(Number),
            gzip: expect.any(Number),
            brotli: expect.any(Number),
          },
        },
      ])
      expect(snapshots[0]?.totals.raw).toBeGreaterThan(0)
      expect(snapshots[0]?.totals.gzip).toBeGreaterThan(0)
      expect(snapshots[0]?.totals.brotli).toBeGreaterThan(0)
    } finally {
      process.chdir(previousCwd)
    }
  })
})
