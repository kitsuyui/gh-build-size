import * as core from '@actions/core'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { publishAssets } from './github'

import type { FilesSnapshot, NormalizedConfig, SummaryStatus } from './types'

vi.mock('@actions/core', () => ({
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
    rest: {
      git: {
        getRef: vi.fn(),
        createTree: vi.fn(),
        createCommit: vi.fn(),
        updateRef: vi.fn(),
        createRef: vi.fn(),
      },
    },
  } as unknown as Parameters<typeof publishAssets>[0]
}

describe('publishAssets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('updates an existing publish branch without force', async () => {
    const octokit = createOctokit()
    vi.mocked(octokit.rest.git.getRef).mockResolvedValue({
      data: { object: { sha: 'old-tip' } },
    } as Awaited<ReturnType<typeof octokit.rest.git.getRef>>)
    vi.mocked(octokit.rest.git.createTree).mockResolvedValue({
      data: { sha: 'tree' },
    } as Awaited<ReturnType<typeof octokit.rest.git.createTree>>)
    vi.mocked(octokit.rest.git.createCommit).mockResolvedValue({
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
    vi.mocked(octokit.rest.git.getRef)
      .mockResolvedValueOnce({
        data: { object: { sha: 'old-tip' } },
      } as Awaited<ReturnType<typeof octokit.rest.git.getRef>>)
      .mockResolvedValueOnce({
        data: { object: { sha: 'latest-tip' } },
      } as Awaited<ReturnType<typeof octokit.rest.git.getRef>>)
    vi.mocked(octokit.rest.git.createTree)
      .mockResolvedValueOnce({
        data: { sha: 'tree-1' },
      } as Awaited<ReturnType<typeof octokit.rest.git.createTree>>)
      .mockResolvedValueOnce({
        data: { sha: 'tree-2' },
      } as Awaited<ReturnType<typeof octokit.rest.git.createTree>>)
    vi.mocked(octokit.rest.git.createCommit)
      .mockResolvedValueOnce({
        data: { sha: 'commit-1' },
      } as Awaited<ReturnType<typeof octokit.rest.git.createCommit>>)
      .mockResolvedValueOnce({
        data: { sha: 'commit-2' },
      } as Awaited<ReturnType<typeof octokit.rest.git.createCommit>>)
    vi.mocked(octokit.rest.git.updateRef)
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
