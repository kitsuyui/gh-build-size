import fs from 'node:fs/promises'
import path from 'node:path'
import * as core from '@actions/core'
import * as github from '@actions/github'

import { renderBadge } from './badge'
import { buildMarker, decideCommentAction, renderComment } from './comment'
import { renderReportMarkdown } from './report'
import { normalizePublishedSummary } from './schema'

import type {
  FilesSnapshot,
  NormalizedConfig,
  SummaryStatus,
  TargetSnapshot,
  TargetStatus,
} from './types'

type Octokit = ReturnType<typeof github.getOctokit>

const PUBLISH_BRANCH_MAX_ATTEMPTS = 3
const MANAGED_COMMENT_PAGE_SIZE = 100
const MANAGED_COMMENT_SEARCH_MAX_PAGES = 10
type ManagedComment = { id: number; body: string }
type ManagedCommentAuthor = { id: number; login: string }
type CommentUser = { id?: number; login?: string } | null | undefined

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

function isRefConflictError(error: unknown): boolean {
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
  ) {
    return [409, 422].includes(error.status)
  }
  return false
}

async function getManagedCommentAuthor(
  octokit: Octokit,
): Promise<ManagedCommentAuthor> {
  const response = await octokit.rest.users.getAuthenticated()
  return {
    id: response.data.id,
    login: response.data.login,
  }
}

function isManagedCommentAuthor(
  user: CommentUser,
  author: ManagedCommentAuthor,
): boolean {
  if (!user) {
    return false
  }
  if (typeof user.id === 'number' && user.id === author.id) {
    return true
  }
  return user.login === author.login
}

async function findManagedComments(
  octokit: Octokit,
  marker: string,
  author: ManagedCommentAuthor,
): Promise<ManagedComment[]> {
  const issueNumber = github.context.payload.pull_request?.number
  if (!issueNumber) {
    return []
  }
  const pages = octokit.paginate.iterator(octokit.rest.issues.listComments, {
    ...github.context.repo,
    issue_number: issueNumber,
    per_page: MANAGED_COMMENT_PAGE_SIZE,
  })

  let searchedPages = 0
  for await (const page of pages) {
    searchedPages += 1
    const comments = page.data.flatMap((comment) => {
      if (!comment.body?.includes(marker)) {
        return []
      }
      if (!isManagedCommentAuthor(comment.user, author)) {
        return []
      }
      return [{ id: comment.id, body: comment.body }]
    })
    if (comments.length > 0) {
      return comments
    }
    if (searchedPages >= MANAGED_COMMENT_SEARCH_MAX_PAGES) {
      core.warning(
        `gh-build-size stopped searching pull request comments after ${MANAGED_COMMENT_SEARCH_MAX_PAGES} pages without finding its marker.`,
      )
      return []
    }
  }

  return []
}

async function deleteDuplicateManagedComments(
  octokit: Octokit,
  comments: ManagedComment[],
): Promise<void> {
  for (const comment of comments.slice(1)) {
    await octokit.rest.issues.deleteComment({
      ...github.context.repo,
      comment_id: comment.id,
    })
  }
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
    const managedCommentAuthor = await getManagedCommentAuthor(octokit)
    let existingComments = await findManagedComments(
      octokit,
      marker,
      managedCommentAuthor,
    )
    let action = decideCommentAction(existingComments[0] ?? null, body)
    if (action.type === 'create') {
      existingComments = await findManagedComments(
        octokit,
        marker,
        managedCommentAuthor,
      )
      action = decideCommentAction(existingComments[0] ?? null, body)
    }

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
    await deleteDuplicateManagedComments(octokit, existingComments)
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
  normalize: (value: unknown) => T | null,
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
    const parsed = JSON.parse(
      Buffer.from(response.data.content, 'base64').toString('utf8'),
    )
    const normalized = normalize(parsed)
    if (normalized === null) {
      core.warning(
        `gh-build-size ignored published JSON "${filename}" on branch "${branch}" because it does not match a supported schema.`,
      )
      return null
    }
    return normalized
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
  return fetchPublishedJson<SummaryStatus>(
    octokit,
    branch,
    summaryFilename,
    normalizePublishedSummary,
  )
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

    for (let attempt = 1; attempt <= PUBLISH_BRANCH_MAX_ATTEMPTS; attempt++) {
      const branchState = await ensureBranch(octokit, branch)
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

      try {
        if (branchState.commitSha) {
          await octokit.rest.git.updateRef({
            ...github.context.repo,
            ref: `heads/${branch}`,
            sha: commit.data.sha,
            force: false,
          })
        } else {
          await octokit.rest.git.createRef({
            ...github.context.repo,
            ref: `refs/heads/${branch}`,
            sha: commit.data.sha,
          })
        }
        return
      } catch (error) {
        if (
          !isRefConflictError(error) ||
          attempt === PUBLISH_BRANCH_MAX_ATTEMPTS
        ) {
          throw error
        }
        core.warning(
          `gh-build-size publish branch "${branch}" changed during publish; retrying with the latest branch tip.`,
        )
      }
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
