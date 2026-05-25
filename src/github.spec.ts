import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as core from '@actions/core'
import * as github from '@actions/github'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import {
  publishAssets,
  updatePullRequestComment,
  writeOutputFiles,
} from './github'

import type { FilesSnapshot, NormalizedConfig, SummaryStatus } from './types'

vi.mock('@actions/core', () => ({
  setOutput: vi.fn(),
  warning: vi.fn(),
}))

vi.mock('@actions/github', () => ({
  context: {
    repo: {
      owner: 'kitsuyui',
      repo: 'gh-build-size',
    },
    payload: {},
  },
  getOctokit: vi.fn(),
}))

const summary: SummaryStatus = {
  schema_version: 1,
  generated_at: '2026-05-16T00:00:00.000Z',
  repository: 'kitsuyui/gh-build-size',
  default_branch: 'main',
  publish_branch: 'gh-build-size',
  event_name: 'push',
  base_label: 'main',
  base_reference: 'base',
  head_label: 'main',
  head_reference: 'head',
  targets: [],
}

const filesSnapshot: FilesSnapshot = {
  schema_version: 1,
  generated_at: '2026-05-16T00:00:00.000Z',
  repository: 'kitsuyui/gh-build-size',
  default_branch: 'main',
  publish_branch: 'gh-build-size',
  event_name: 'push',
  head_reference: 'head',
  files: [],
}

const config: NormalizedConfig = {
  comment: {
    enabled: true,
    key: 'gh-build-size',
    template: '{{ summary }}',
  },
  publish: {
    enabled: true,
    branch: 'gh-build-size',
    directory: '.gh-build-size',
    summary_filename: 'summary.json',
    files_filename: 'files.json',
    report_filename: 'report.md',
    badges_directory: 'badges',
    targets_directory: 'targets',
  },
  targets: [],
}

function createOctokit() {
  return {
    paginate: createPaginateMock(),
    rest: {
      git: {
        getRef: vi.fn(),
        createTree: vi.fn(),
        createCommit: vi.fn(),
        updateRef: vi.fn(),
        createRef: vi.fn(),
      },
      issues: {
        listComments: vi.fn(),
        createComment: vi.fn(),
        updateComment: vi.fn(),
        deleteComment: vi.fn(),
      },
    },
  } as unknown as Parameters<typeof publishAssets>[0] &
    Parameters<typeof updatePullRequestComment>[0]
}

function mockFn(fn: unknown): ReturnType<typeof vi.fn> {
  return fn as ReturnType<typeof vi.fn>
}

function createPaginateMock(): ReturnType<typeof vi.fn> & {
  iterator: ReturnType<typeof vi.fn>
} {
  return Object.assign(vi.fn(), { iterator: vi.fn() })
}

async function* commentPages(
  pages: Array<Array<{ id: number; body?: string | null }>>,
) {
  for (const data of pages) {
    yield { data }
  }
}

function createCommentableSummary(): SummaryStatus {
  return {
    ...summary,
    publish_branch: null,
    event_name: 'pull_request',
    head_label: '#123',
    targets: [
      {
        id: 'web',
        label: 'web',
        files: ['dist/app.js'],
        touched_files: ['dist/app.js'],
        baseline_missing: false,
        commentable: true,
        sizes: {
          raw: {
            enabled: true,
            current: 120,
            base: 100,
            delta: 20,
          },
          gzip: {
            enabled: true,
            current: 60,
            base: 50,
            delta: 10,
          },
          brotli: {
            enabled: true,
            current: 55,
            base: 45,
            delta: 10,
          },
        },
        violations: [],
        badge_path: '.gh-build-size/badges/web.svg',
        target_path: '.gh-build-size/targets/web.json',
      },
    ],
  }
}

const commentConfig: NormalizedConfig = {
  ...config,
  comment: {
    enabled: true,
    key: 'gh-build-size',
    template: '{{{marker}}}\nupdated body',
  },
}

describe('writeOutputFiles', () => {
  let tmpBase: string
  let outputDir: string

  beforeEach(async () => {
    tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), 'gh-build-size-test-'))
    outputDir = path.join(tmpBase, 'output')
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await fs.rm(tmpBase, { recursive: true, force: true })
  })

  test('writes all expected files and cleans up staging dir', async () => {
    await writeOutputFiles(outputDir, summary, filesSnapshot, [], [], config)

    const files = await fs.readdir(outputDir)
    expect(files).toContain('summary.json')
    expect(files).toContain('files.json')
    expect(files).toContain('report.md')

    // Staging dir must not remain after a successful write
    await expect(fs.access(`${outputDir}.tmp`)).rejects.toThrow()
  })

  test('replaces a pre-existing output directory atomically', async () => {
    // Simulate a previous partial run leaving stale files in outputDir
    await fs.mkdir(outputDir, { recursive: true })
    await fs.writeFile(path.join(outputDir, 'stale.txt'), 'stale')

    await writeOutputFiles(outputDir, summary, filesSnapshot, [], [], config)

    const files = await fs.readdir(outputDir)
    expect(files).toContain('summary.json')
    expect(files).not.toContain('stale.txt')
    await expect(fs.access(`${outputDir}.tmp`)).rejects.toThrow()
  })
})

describe('publishAssets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    github.context.payload = {}
  })

  test('updates an existing publish branch without force', async () => {
    const octokit = createOctokit()
    mockFn(octokit.rest.git.getRef).mockResolvedValue({
      data: { object: { sha: 'old-tip' } },
    } as Awaited<ReturnType<typeof octokit.rest.git.getRef>>)
    mockFn(octokit.rest.git.createTree).mockResolvedValue({
      data: { sha: 'tree' },
    } as Awaited<ReturnType<typeof octokit.rest.git.createTree>>)
    mockFn(octokit.rest.git.createCommit).mockResolvedValue({
      data: { sha: 'new-tip' },
    } as Awaited<ReturnType<typeof octokit.rest.git.createCommit>>)

    await publishAssets(octokit, summary, filesSnapshot, [], [], config)

    expect(octokit.rest.git.createCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        parents: ['old-tip'],
      }),
    )
    expect(octokit.rest.git.updateRef).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: 'heads/gh-build-size',
        sha: 'new-tip',
        force: false,
      }),
    )
  })

  test('retries publish branch updates after a ref conflict', async () => {
    const octokit = createOctokit()
    mockFn(octokit.rest.git.getRef)
      .mockResolvedValueOnce({
        data: { object: { sha: 'old-tip' } },
      } as Awaited<ReturnType<typeof octokit.rest.git.getRef>>)
      .mockResolvedValueOnce({
        data: { object: { sha: 'latest-tip' } },
      } as Awaited<ReturnType<typeof octokit.rest.git.getRef>>)
    mockFn(octokit.rest.git.createTree)
      .mockResolvedValueOnce({
        data: { sha: 'tree-1' },
      } as Awaited<ReturnType<typeof octokit.rest.git.createTree>>)
      .mockResolvedValueOnce({
        data: { sha: 'tree-2' },
      } as Awaited<ReturnType<typeof octokit.rest.git.createTree>>)
    mockFn(octokit.rest.git.createCommit)
      .mockResolvedValueOnce({
        data: { sha: 'commit-1' },
      } as Awaited<ReturnType<typeof octokit.rest.git.createCommit>>)
      .mockResolvedValueOnce({
        data: { sha: 'commit-2' },
      } as Awaited<ReturnType<typeof octokit.rest.git.createCommit>>)
    mockFn(octokit.rest.git.updateRef)
      .mockRejectedValueOnce({ status: 409 })
      .mockResolvedValueOnce(
        {} as Awaited<ReturnType<typeof octokit.rest.git.updateRef>>,
      )

    await publishAssets(octokit, summary, filesSnapshot, [], [], config)

    expect(octokit.rest.git.getRef).toHaveBeenCalledTimes(2)
    expect(octokit.rest.git.createCommit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        parents: ['latest-tip'],
      }),
    )
    expect(octokit.rest.git.updateRef).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sha: 'commit-2',
        force: false,
      }),
    )
    expect(core.warning).toHaveBeenCalledWith(
      'gh-build-size publish branch "gh-build-size" changed during publish; retrying with the latest branch tip.',
    )
  })
})

describe('updatePullRequestComment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    github.context.payload = { pull_request: { number: 123 } }
  })

  test('updates the first managed comment and deletes duplicate marker comments', async () => {
    const octokit = createOctokit()
    mockFn(octokit.paginate.iterator).mockReturnValue(
      commentPages([
        [
          { id: 1, body: '<!-- gh-build-size:gh-build-size -->\nold body' },
          { id: 2, body: '<!-- gh-build-size:gh-build-size -->\nduplicate' },
          { id: 3, body: 'unmanaged comment' },
        ],
      ]),
    )

    await updatePullRequestComment(
      octokit,
      createCommentableSummary(),
      commentConfig,
    )

    expect(octokit.rest.issues.updateComment).toHaveBeenCalledWith(
      expect.objectContaining({
        comment_id: 1,
        body: '<!-- gh-build-size:gh-build-size -->\nupdated body',
      }),
    )
    expect(octokit.rest.issues.deleteComment).toHaveBeenCalledWith(
      expect.objectContaining({
        comment_id: 2,
      }),
    )
    expect(octokit.rest.issues.createComment).not.toHaveBeenCalled()
  })

  test('rechecks comments before creating a new managed comment', async () => {
    const octokit = createOctokit()
    mockFn(octokit.paginate.iterator)
      .mockReturnValueOnce(commentPages([[]]))
      .mockReturnValueOnce(
        commentPages([
          [
            {
              id: 4,
              body: '<!-- gh-build-size:gh-build-size -->\nraced body',
            },
          ],
        ]),
      )

    await updatePullRequestComment(
      octokit,
      createCommentableSummary(),
      commentConfig,
    )

    expect(octokit.paginate.iterator).toHaveBeenCalledTimes(2)
    expect(octokit.rest.issues.updateComment).toHaveBeenCalledWith(
      expect.objectContaining({
        comment_id: 4,
        body: '<!-- gh-build-size:gh-build-size -->\nupdated body',
      }),
    )
    expect(octokit.rest.issues.createComment).not.toHaveBeenCalled()
  })

  test('stops scanning comment pages after finding the marker', async () => {
    const octokit = createOctokit()
    const secondPageVisited = vi.fn()
    async function* pages() {
      yield {
        data: [
          { id: 1, body: '<!-- gh-build-size:gh-build-size -->\nold body' },
        ],
      }
      secondPageVisited()
      yield {
        data: [
          { id: 2, body: '<!-- gh-build-size:gh-build-size -->\nduplicate' },
        ],
      }
    }
    mockFn(octokit.paginate.iterator).mockReturnValue(pages())

    await updatePullRequestComment(
      octokit,
      createCommentableSummary(),
      commentConfig,
    )

    expect(secondPageVisited).not.toHaveBeenCalled()
    expect(octokit.rest.issues.updateComment).toHaveBeenCalledWith(
      expect.objectContaining({
        comment_id: 1,
      }),
    )
  })
})
