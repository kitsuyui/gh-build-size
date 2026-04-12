import fs from 'node:fs/promises'
import { promisify } from 'node:util'
import zlib from 'node:zlib'
import fg from 'fast-glob'
import micromatch from 'micromatch'

import type { Compression, TargetConfig, TargetSnapshot } from './types'

const gzip = promisify(zlib.gzip)
const brotliCompress = promisify(zlib.brotliCompress)

export interface RevisionReader {
  listFiles(revision: string): Promise<string[]>
  readFile(revision: string, filePath: string): Promise<Buffer>
}

async function compressBuffer(
  compression: Compression,
  content: Buffer,
): Promise<number> {
  if (compression === 'raw') {
    return content.byteLength
  }
  if (compression === 'gzip') {
    return (await gzip(content)).byteLength
  }
  return (
    await brotliCompress(content, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
      },
    })
  ).byteLength
}

async function filesForWorkspace(target: TargetConfig): Promise<string[]> {
  const found = await fg(target.files, {
    dot: false,
    onlyFiles: true,
    ignore: target.exclude ?? [],
    unique: true,
  })
  return found.sort()
}

function filesForRevision(allFiles: string[], target: TargetConfig): string[] {
  return micromatch(allFiles, target.files, {
    ignore: target.exclude ?? [],
  }).sort()
}

async function measureFiles(
  files: string[],
  compressions: Compression[],
  readFile: (filePath: string) => Promise<Buffer>,
): Promise<Record<Compression, number>> {
  const totals: Record<Compression, number> = {
    raw: 0,
    gzip: 0,
    brotli: 0,
  }

  for (const filePath of files) {
    const content = await readFile(filePath)
    for (const compression of compressions) {
      totals[compression] += await compressBuffer(compression, content)
    }
  }

  return totals
}

export async function measureWorkspaceTargets(
  targets: Array<TargetConfig & { label: string; compressions: Compression[] }>,
): Promise<TargetSnapshot[]> {
  return Promise.all(
    targets.map(async (target) => {
      const files = await filesForWorkspace(target)
      const totals = await measureFiles(
        files,
        target.compressions,
        (filePath) => fs.readFile(filePath),
      )

      return {
        id: target.id,
        label: target.label,
        files,
        totals,
      }
    }),
  )
}

export async function measureRevisionTargets(
  revision: string,
  targets: Array<TargetConfig & { label: string; compressions: Compression[] }>,
  reader: RevisionReader,
): Promise<TargetSnapshot[]> {
  const revisionFiles = await reader.listFiles(revision)
  return Promise.all(
    targets.map(async (target) => {
      const files = filesForRevision(revisionFiles, target)
      const totals = await measureFiles(
        files,
        target.compressions,
        (filePath) => reader.readFile(revision, filePath),
      )

      return {
        id: target.id,
        label: target.label,
        files,
        totals,
      }
    }),
  )
}
