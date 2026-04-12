import path from 'node:path'
import * as core from '@actions/core'
import * as github from '@actions/github'

import { getInputs, loadConfig, normalizeConfig } from './config'
import { countFailingViolations, evaluateTargets } from './evaluate'
import {
  createGitRevisionReader,
  currentHeadReference,
  listChangedFiles,
  resolvePullRequestBaseReference,
  touchedFilesForTarget,
} from './git'
import {
  fetchPublishedSummary,
  publishAssets,
  updatePullRequestComment,
  writeOutputFiles,
} from './github'
import { measureRevisionTargets, measureWorkspaceTargets } from './measure'

import type { FilesSnapshot, SummaryStatus } from './types'

async function resolveDefaultBranch(configDefault?: string): Promise<string> {
  return (
    configDefault ?? github.context.payload.repository?.default_branch ?? 'main'
  )
}

function attachOutputPaths(
  summary: SummaryStatus,
  outputDir: string,
): SummaryStatus {
  return {
    ...summary,
    targets: summary.targets.map((target) => ({
      ...target,
      badge_path: path.join(outputDir, 'badges', `${target.id}.svg`),
      target_path: path.join(outputDir, 'targets', `${target.id}.json`),
    })),
  }
}

function buildSummary(
  defaultBranch: string,
  publishBranch: string | null,
  baseLabel: string,
  baseReference: string | null,
  headLabel: string,
  headReference: string,
  targets: SummaryStatus['targets'],
): SummaryStatus {
  return {
    generated_at: new Date().toISOString(),
    repository: github.context.payload.repository?.full_name ?? '',
    default_branch: defaultBranch,
    publish_branch: publishBranch,
    event_name: github.context.eventName,
    base_label: baseLabel,
    base_reference: baseReference,
    head_label: headLabel,
    head_reference: headReference,
    targets,
  }
}

function buildFilesSnapshot(
  defaultBranch: string,
  publishBranch: string | null,
  headReference: string,
  snapshots: Awaited<ReturnType<typeof measureWorkspaceTargets>>,
): FilesSnapshot {
  const files = new Map<string, FilesSnapshot['files'][number]>()

  for (const snapshot of snapshots) {
    for (const file of snapshot.files) {
      files.set(file.path, file)
    }
  }

  return {
    generated_at: new Date().toISOString(),
    repository: github.context.payload.repository?.full_name ?? '',
    default_branch: defaultBranch,
    publish_branch: publishBranch,
    event_name: github.context.eventName,
    head_reference: headReference,
    files: [...files.values()].sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
  }
}

async function run(): Promise<void> {
  const inputs = getInputs()
  const actionConfig = await loadConfig(inputs.configPath)
  const config = await normalizeConfig(actionConfig, inputs)
  const defaultBranch = await resolveDefaultBranch(config.defaultBranch)
  const octokit = github.getOctokit(inputs.githubToken)
  const headReference = await currentHeadReference()
  const currentSnapshots = await measureWorkspaceTargets(config.targets)

  let baseReference: string | null = null
  const baseLabel = defaultBranch
  let headLabel = defaultBranch
  let baseSnapshots: Awaited<ReturnType<typeof measureWorkspaceTargets>> = []
  let changedFiles: string[] = []
  let publishedTargetIds: Set<string> | null = null

  if (github.context.eventName === 'pull_request') {
    baseReference = await resolvePullRequestBaseReference(defaultBranch)
    changedFiles = await listChangedFiles(baseReference)
    baseSnapshots = await measureRevisionTargets(
      baseReference,
      config.targets,
      createGitRevisionReader(),
    )
    if (config.publish.enabled) {
      const publishedSummary = await fetchPublishedSummary(
        octokit,
        config.publish.branch,
        path.posix.join(
          config.publish.directory,
          config.publish.summary_filename,
        ),
      )
      publishedTargetIds = new Set(
        publishedSummary?.targets.map((target) => target.id) ?? [],
      )
    }
    headLabel = `#${github.context.payload.pull_request?.number ?? 'pr'}`
  } else if (
    github.context.eventName === 'push' &&
    github.context.ref === `refs/heads/${defaultBranch}` &&
    config.publish.enabled
  ) {
    const publishedSummary = await fetchPublishedSummary(
      octokit,
      config.publish.branch,
      path.posix.join(
        config.publish.directory,
        config.publish.summary_filename,
      ),
    )
    baseReference = publishedSummary?.head_reference ?? null
    baseSnapshots =
      publishedSummary?.targets.map((target) => ({
        id: target.id,
        label: target.label,
        files: target.files.map((filePath) => ({
          path: filePath,
          sizes: {
            raw: 0,
            gzip: 0,
            brotli: 0,
          },
        })),
        totals: {
          raw: target.sizes.raw.current,
          gzip: target.sizes.gzip.current,
          brotli: target.sizes.brotli.current,
        },
      })) ?? []
  }

  const touchedFilesByTarget = new Map(
    config.targets
      .map(
        (target) =>
          [target.id, touchedFilesForTarget(target, changedFiles)] as const,
      )
      .filter(([, touchedFiles]) => touchedFiles.length > 0),
  )

  const evaluatedTargets = evaluateTargets(
    config,
    currentSnapshots,
    baseSnapshots,
    touchedFilesByTarget,
    publishedTargetIds,
    github.context.eventName === 'pull_request',
  )
  const publishBranch =
    github.context.eventName === 'push' &&
    github.context.ref === `refs/heads/${defaultBranch}` &&
    config.publish.enabled
      ? config.publish.branch
      : null

  const summary = attachOutputPaths(
    buildSummary(
      defaultBranch,
      publishBranch,
      baseLabel,
      baseReference,
      headLabel,
      headReference,
      evaluatedTargets,
    ),
    inputs.outputDir,
  )
  const filesSnapshot = buildFilesSnapshot(
    defaultBranch,
    publishBranch,
    headReference,
    currentSnapshots,
  )

  await writeOutputFiles(
    inputs.outputDir,
    summary,
    filesSnapshot,
    evaluatedTargets,
    currentSnapshots,
    config,
  )

  if (github.context.eventName === 'pull_request') {
    await updatePullRequestComment(octokit, summary, config)
  }
  if (publishBranch) {
    await publishAssets(
      octokit,
      summary,
      filesSnapshot,
      evaluatedTargets,
      currentSnapshots,
      config,
    )
  }

  const failingViolations = countFailingViolations(evaluatedTargets)
  core.setOutput('violation-count', String(failingViolations))
  core.setOutput('has-violations', String(failingViolations > 0))
  core.setOutput('publish-branch', publishBranch ?? '')

  if (failingViolations > 0) {
    core.setFailed(
      `gh-build-size detected ${failingViolations} failing size violation(s).`,
    )
  }
}

run().catch((error: unknown) => {
  if (error instanceof Error) {
    core.setFailed(error.message)
    return
  }
  core.setFailed(String(error))
})
