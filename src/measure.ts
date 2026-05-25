import fs from 'node:fs/promises'
import { promisify } from 'node:util'
import zlib from 'node:zlib'
import fg from 'fast-glob'
import micromatch from 'micromatch'
import { assertFileWithinMaxBytes, DEFAULT_MAX_FILE_BYTES } from './limits'
import { PUBLISHED_SCHEMA_VERSION } from './schema'
import type {
  Compression,
  FileSnapshot,
  TargetConfig,
  TargetSnapshot,
} from './types'

const gzip = promisify(zlib.gzip)
const brotliCompress = promisify(zlib.brotliCompress)

export interface RevisionReader {
  listFiles(revision: string): Promise<string[]>
  readFile(
    revision: string,
    filePath: string,
    maxFileBytes: number,
  ): Promise<Buffer>
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

async function readWorkspaceFile(
  filePath: string,
  maxFileBytes: number,
): Promise<Buffer> {
  const stats = await fs.stat(filePath)
  assertFileWithinMaxBytes(filePath, stats.size, maxFileBytes)
  const content = await fs.readFile(filePath)
  assertFileWithinMaxBytes(filePath, content.byteLength, maxFileBytes)
  return content
}

function filesForRevision(allFiles: string[], target: TargetConfig): string[] {
  return micromatch(allFiles, target.files, {
    ignore: target.exclude ?? [],
  }).sort()
}

async function measureFiles(
  files: string[],
  compressions: Compression[],
  maxFileBytes: number,
  readFile: (filePath: string, maxFileBytes: number) => Promise<Buffer>,
): Promise<{
  files: FileSnapshot[]
  totals: Record<Compression, number>
}> {
  const totals: Record<Compression, number> = {
    raw: 0,
    gzip: 0,
    brotli: 0,
  }
  const measuredFiles: FileSnapshot[] = []

  for (const filePath of files) {
    const content = await readFile(filePath, maxFileBytes)
    assertFileWithinMaxBytes(filePath, content.byteLength, maxFileBytes)
    const sizes: Record<Compression, number> = {
      raw: 0,
      gzip: 0,
      brotli: 0,
    }
    for (const compression of compressions) {
      const size = await compressBuffer(compression, content)
      totals[compression] += size
      sizes[compression] = size
    }
    measuredFiles.push({
      path: filePath,
      sizes,
    })
  }

  return {
    files: measuredFiles,
    totals,
  }
}

export async function measureWorkspaceTargets(
  targets: Array<TargetConfig & { label: string; compressions: Compression[] }>,
): Promise<TargetSnapshot[]> {
  return Promise.all(
    targets.map(async (target) => {
      const files = await filesForWorkspace(target)
      const maxFileBytes = target.max_file_bytes ?? DEFAULT_MAX_FILE_BYTES
      const measured = await measureFiles(
        files,
        target.compressions,
        maxFileBytes,
        readWorkspaceFile,
      )

      return {
        schema_version: PUBLISHED_SCHEMA_VERSION,
        id: target.id,
        label: target.label,
        files: measured.files,
        totals: measured.totals,
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
      const maxFileBytes = target.max_file_bytes ?? DEFAULT_MAX_FILE_BYTES
      const measured = await measureFiles(
        files,
        target.compressions,
        maxFileBytes,
        (filePath, limit) => reader.readFile(revision, filePath, limit),
      )

      return {
        schema_version: PUBLISHED_SCHEMA_VERSION,
        id: target.id,
        label: target.label,
        files: measured.files,
        totals: measured.totals,
      }
    }),
  )
}
