import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, test } from 'vitest'

import { createGitRevisionReader, isAncestorCommit } from './git'

const execFileAsync = promisify(execFile)

describe('isAncestorCommit', () => {
  test('returns true for the current HEAD commit', async () => {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'])
    const headSha = stdout.trim()
    expect(await isAncestorCommit(headSha)).toBe(true)
  })

  test('returns false for an all-zero SHA that does not exist', async () => {
    expect(
      await isAncestorCommit('0000000000000000000000000000000000000000'),
    ).toBe(false)
  })
})

describe('createGitRevisionReader', () => {
  test('rejects revision files that exceed max_file_bytes', async () => {
    const reader = createGitRevisionReader()

    await expect(reader.readFile('HEAD', 'README.md', 1)).rejects.toThrow(
      'exceeds max_file_bytes',
    )
  })
})
