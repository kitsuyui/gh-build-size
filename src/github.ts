import fs from 'node:fs/promises'
import path from 'node:path'
import * as core from '@actions/core'
import * as github from '@actions/github'

import { renderBadge } from './badge'
import { buildMarker, decideCommentAction, renderComment } from './comment'
import { renderReportMarkdown } from './report'

import type {
  FilesSnapshot,
  NormalizedConfig,
  SummaryStatus,
  TargetSnapshot,
  TargetStatus,
} from './types'

type Octokit = ReturnType<typeof github.getOctokit>

function isPermissionError(error: unknown): boolean {
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
  ) {
    return [401, 403, 404].includes(error.status)
  }
  return false
}

async function findManagedComment(
  octokit: Octokit,
  marker: string,
): Promise<{ id: number; body: string } | null> {
  const issueNumber = github.context.payload.pull_request?.number
  if (!issueNumber) {
    return null
  }
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    ...github.context.repo,
    issue_number: issueNumber,
    per_page: 100,
  })
  const found = comments.find((comment) => comment.body?.includes(marker))
  if (!found?.body) {
    return null
  }
  return { id: found.id, body: found.body }
}

export async function updatePullRequestComment(
  octokit: Octokit,
  summary: SummaryStatus,
  config: NormalizedConfig,
): Promise<void> {
  const issueNumber = github.context.payload.pull_request?.number
  if (!issueNumber || !config.comment.enabled) {
    return
  }
  const marker = buildMarker(config.comment.key)
  const body = summary.targets.some((target) => target.commentable)
    ? renderComment(summary, config.comment.template, marker)
    : null

  try {
    const existing = await findManagedComment(octokit, marker)
    const action = decideCommentAction(existing, body)
    if (action.type === 'create') {
      await octokit.rest.issues.createComment({
        ...github.context.repo,
        issue_number: issueNumber,
        body: action.body,
      })
    } else if (action.type === 'update') {
      await octokit.rest.issues.updateComment({
        ...github.context.repo,
        comment_id: action.commentId,
        body: action.body,
      })
    } else if (action.type === 'delete') {
      await octokit.rest.issues.deleteComment({
        ...github.context.repo,
        comment_id: action.commentId,
      })
    }
  } catch (error) {
    if (isPermissionError(error)) {
      core.warning(
        'gh-build-size skipped PR comment updates because the workflow token cannot write pull request comments.',
      )
      return
    }
    throw error
  }
}

async function fetchPublishedJson<T>(
  octokit: Octokit,
  branch: string,
  filename: string,
): Promise<T | null> {
  try {
    const response = await octokit.rest.repos.getContent({
      ...github.context.repo,
      path: filename,
      ref: branch,
    })
    if (
      !('content' in response.data) ||
      typeof response.data.content !== 'string'
    ) {
      return null
    }
    return JSON.parse(
      Buffer.from(response.data.content, 'base64').toString('utf8'),
    ) as T
  } catch (error) {
    if (isPermissionError(error)) {
      return null
    }
    throw error
  }
}

export async function fetchPublishedSummary(
  octokit: Octokit,
  branch: string,
  summaryFilename: string,
): Promise<SummaryStatus | null> {
  return fetchPublishedJson<SummaryStatus>(octokit, branch, summaryFilename)
}

async function ensureBranch(
  octokit: Octokit,
  branch: string,
): Promise<{ commitSha: string | null }> {
  try {
    const ref = await octokit.rest.git.getRef({
      ...github.context.repo,
      ref: `heads/${branch}`,
    })
    return {
      commitSha: ref.data.object.sha,
    }
  } catch (error) {
    if (!isPermissionError(error)) {
      throw error
    }
  }
  return { commitSha: null }
}

export async function publishAssets(
  octokit: Octokit,
  summary: SummaryStatus,
  filesSnapshot: FilesSnapshot,
  targetStatuses: TargetStatus[],
  snapshots: TargetSnapshot[],
  config: NormalizedConfig,
): Promise<void> {
  if (!config.publish.enabled || !summary.publish_branch) {
    return
  }

  const branch = summary.publish_branch
  try {
    const branchState = await ensureBranch(octokit, branch)
    const treeEntries = [
      {
        path: path.posix.join(
          config.publish.directory,
          config.publish.summary_filename,
        ),
        mode: '100644' as const,
        type: 'blob' as const,
        content: `${JSON.stringify(summary, null, 2)}\n`,
      },
      {
        path: path.posix.join(
          config.publish.directory,
          config.publish.files_filename,
        ),
        mode: '100644' as const,
        type: 'blob' as const,
        content: `${JSON.stringify(filesSnapshot, null, 2)}\n`,
      },
      {
        path: path.posix.join(
          config.publish.directory,
          config.publish.report_filename,
        ),
        mode: '100644' as const,
        type: 'blob' as const,
        content: renderReportMarkdown(filesSnapshot),
      },
    ]

    for (const target of targetStatuses) {
      const targetConfig = config.targets.find((item) => item.id === target.id)
      const snapshot = snapshots.find((item) => item.id === target.id)
      if (!targetConfig || !snapshot) {
        continue
      }
      treeEntries.push({
        path: path.posix.join(
          config.publish.directory,
          config.publish.badges_directory,
          `${target.id}.svg`,
        ),
        mode: '100644' as const,
        type: 'blob' as const,
        content: renderBadge(target, targetConfig.badge),
      })
      treeEntries.push({
        path: path.posix.join(
          config.publish.directory,
          config.publish.targets_directory,
          `${target.id}.json`,
        ),
        mode: '100644' as const,
        type: 'blob' as const,
        content: `${JSON.stringify(snapshot, null, 2)}\n`,
      })
    }

    const tree = await octokit.rest.git.createTree({
      ...github.context.repo,
      tree: treeEntries,
    })
    const commit = await octokit.rest.git.createCommit({
      ...github.context.repo,
      message: 'Update gh-build-size assets',
      tree: tree.data.sha,
      parents: branchState.commitSha ? [branchState.commitSha] : [],
    })

    if (branchState.commitSha) {
      await octokit.rest.git.updateRef({
        ...github.context.repo,
        ref: `heads/${branch}`,
        sha: commit.data.sha,
        force: true,
      })
    } else {
      await octokit.rest.git.createRef({
        ...github.context.repo,
        ref: `refs/heads/${branch}`,
        sha: commit.data.sha,
      })
    }
  } catch (error) {
    if (isPermissionError(error)) {
      core.warning(
        `gh-build-size skipped publish-branch updates because the workflow token cannot write branch "${branch}".`,
      )
      return
    }
    throw error
  }
}

export async function writeOutputFiles(
  outputDir: string,
  summary: SummaryStatus,
  filesSnapshot: FilesSnapshot,
  targetStatuses: TargetStatus[],
  snapshots: TargetSnapshot[],
  config: NormalizedConfig,
): Promise<void> {
  await fs.mkdir(outputDir, { recursive: true })
  await fs.mkdir(path.join(outputDir, 'badges'), { recursive: true })
  await fs.mkdir(path.join(outputDir, 'targets'), { recursive: true })
  const summaryPath = path.join(outputDir, 'summary.json')
  const filesPath = path.join(outputDir, 'files.json')
  const reportPath = path.join(outputDir, 'report.md')
  await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`)
  await fs.writeFile(filesPath, `${JSON.stringify(filesSnapshot, null, 2)}\n`)
  await fs.writeFile(reportPath, renderReportMarkdown(filesSnapshot))

  for (const target of targetStatuses) {
    const targetConfig = config.targets.find((item) => item.id === target.id)
    const snapshot = snapshots.find((item) => item.id === target.id)
    if (!targetConfig || !snapshot) {
      continue
    }
    await fs.writeFile(
      path.join(outputDir, 'badges', `${target.id}.svg`),
      renderBadge(target, targetConfig.badge),
    )
    await fs.writeFile(
      path.join(outputDir, 'targets', `${target.id}.json`),
      `${JSON.stringify(snapshot, null, 2)}\n`,
    )
  }

  core.setOutput('summary-path', summaryPath)
  core.setOutput('files-path', filesPath)
  core.setOutput('report-path', reportPath)
  core.setOutput('summary-json', JSON.stringify(summary))
}
