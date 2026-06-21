import fs from 'node:fs/promises'
import path from 'node:path'
import * as core from '@actions/core'

import { renderBadge } from './badge'
import { renderReportMarkdown } from './report'

import type {
  FilesSnapshot,
  NormalizedConfig,
  SummaryStatus,
  TargetSnapshot,
  TargetStatus,
} from './types'

export async function writeOutputFiles(
  outputDir: string,
  summary: SummaryStatus,
  filesSnapshot: FilesSnapshot,
  targetStatuses: TargetStatus[],
  snapshots: TargetSnapshot[],
  config: NormalizedConfig,
): Promise<void> {
  // Write all files to a staging directory first so that a mid-write process
  // termination (OOM kill, signal) never leaves a partial file set visible at
  // outputDir. The final rename makes the complete set observable atomically.
  const stagingDir = `${outputDir}.tmp`
  await fs.rm(stagingDir, { recursive: true, force: true })
  await fs.mkdir(stagingDir, { recursive: true })
  await fs.mkdir(path.join(stagingDir, 'badges'), { recursive: true })
  await fs.mkdir(path.join(stagingDir, 'targets'), { recursive: true })

  const summaryPath = path.join(outputDir, 'summary.json')
  const filesPath = path.join(outputDir, 'files.json')
  const reportPath = path.join(outputDir, 'report.md')

  await fs.writeFile(
    path.join(stagingDir, 'summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  )
  await fs.writeFile(
    path.join(stagingDir, 'files.json'),
    `${JSON.stringify(filesSnapshot, null, 2)}\n`,
  )
  await fs.writeFile(
    path.join(stagingDir, 'report.md'),
    renderReportMarkdown(filesSnapshot),
  )

  for (const target of targetStatuses) {
    const targetConfig = config.targets.find((item) => item.id === target.id)
    const snapshot = snapshots.find((item) => item.id === target.id)
    if (!targetConfig || !snapshot) {
      continue
    }
    await fs.writeFile(
      path.join(stagingDir, 'badges', `${target.id}.svg`),
      renderBadge(target, targetConfig.badge),
    )
    await fs.writeFile(
      path.join(stagingDir, 'targets', `${target.id}.json`),
      `${JSON.stringify(snapshot, null, 2)}\n`,
    )
  }

  // Swap staging dir into place. Remove any previous output dir so that
  // rename(2) sees an absent destination (Linux requires it for directories).
  await fs.rm(outputDir, { recursive: true, force: true })
  await fs.rename(stagingDir, outputDir)

  core.setOutput('summary-path', summaryPath)
  core.setOutput('files-path', filesPath)
  core.setOutput('report-path', reportPath)
  core.setOutput('summary-json', JSON.stringify(summary))
}
