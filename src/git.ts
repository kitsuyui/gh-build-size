import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as github from '@actions/github'
import micromatch from 'micromatch'

import { assertFileWithinMaxBytes } from './limits'
import type { RevisionReader } from './measure'
import type { TargetConfig } from './types'

const execFileAsync = promisify(execFile)

async function execGit(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    maxBuffer: 32 * 1024 * 1024,
  })
  return stdout.trimEnd()
}

export async function currentHeadReference(): Promise<string> {
  return execGit(['rev-parse', 'HEAD'])
}

export async function resolvePullRequestBaseReference(
  defaultBranch: string,
): Promise<string> {
  const baseSha = github.context.payload.pull_request?.base?.sha
  if (baseSha) {
    return execGit(['merge-base', baseSha, 'HEAD'])
  }
  return execGit(['merge-base', `origin/${defaultBranch}`, 'HEAD'])
}

export async function listChangedFiles(
  baseReference: string,
): Promise<string[]> {
  const output = await execGit([
    'diff',
    '--name-only',
    `${baseReference}...HEAD`,
  ])
  if (!output) {
    return []
  }
  return output.split('\n').filter(Boolean).sort()
}

export function touchedFilesForTarget(
  target: TargetConfig,
  changedFiles: string[],
): string[] {
  return micromatch(changedFiles, target.files, {
    ignore: target.exclude ?? [],
  }).sort()
}

export async function isAncestorCommit(sha: string): Promise<boolean> {
  try {
    await execGit(['merge-base', '--is-ancestor', sha, 'HEAD'])
    return true
  } catch {
    return false
  }
}

export function createGitRevisionReader(): RevisionReader {
  return {
    async listFiles(revision: string): Promise<string[]> {
      const output = await execGit(['ls-tree', '-r', '--name-only', revision])
      if (!output) {
        return []
      }
      return output.split('\n').filter(Boolean)
    },
    async readFile(
      revision: string,
      filePath: string,
      maxFileBytes: number,
    ): Promise<Buffer> {
      const objectName = `${revision}:${filePath}`
      const sizeText = await execGit(['cat-file', '-s', objectName])
      const byteLength = Number(sizeText)
      if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
        throw new Error(
          `Unable to determine the byte size of "${filePath}" at "${revision}".`,
        )
      }
      assertFileWithinMaxBytes(filePath, byteLength, maxFileBytes)
      const { stdout } = await execFileAsync('git', ['show', objectName], {
        encoding: 'buffer',
        maxBuffer: Math.min(maxFileBytes + 1, Number.MAX_SAFE_INTEGER),
      })
      const content = Buffer.from(stdout)
      assertFileWithinMaxBytes(filePath, content.byteLength, maxFileBytes)
      return content
    },
  }
}
