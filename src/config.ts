import fs from 'node:fs/promises'
import path from 'node:path'
import * as core from '@actions/core'
import Ajv from 'ajv'
import fg from 'fast-glob'
import YAML from 'yaml'

import type {
  ActionConfig,
  ActionInputs,
  Compression,
  NormalizedConfig,
  TargetConfig,
  WorkspacePackagesResolverConfig,
} from './types'

const compressions = ['raw', 'gzip', 'brotli'] as const satisfies Compression[]

const thresholdSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    max_bytes: { type: 'integer', minimum: 0 },
    fail: { type: 'boolean' },
  },
}

const ratchetSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    no_increase: { type: 'boolean' },
    fail: { type: 'boolean' },
  },
}

const schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    version: { type: 'integer' },
    default_branch: { type: 'string' },
    comment: {
      type: 'object',
      additionalProperties: false,
      properties: {
        enabled: { type: 'boolean' },
        key: { type: 'string' },
        template: { type: 'string' },
      },
    },
    publish: {
      type: 'object',
      additionalProperties: false,
      properties: {
        enabled: { type: 'boolean' },
        branch: { type: 'string' },
        directory: { type: 'string' },
        summary_filename: { type: 'string' },
        files_filename: { type: 'string' },
        report_filename: { type: 'string' },
        badges_directory: { type: 'string' },
        targets_directory: { type: 'string' },
      },
    },
    targets: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'files'],
        properties: {
          id: { type: 'string', minLength: 1 },
          label: { type: 'string' },
          files: {
            type: 'array',
            minItems: 1,
            items: { type: 'string' },
          },
          exclude: {
            type: 'array',
            items: { type: 'string' },
          },
          compressions: {
            type: 'array',
            minItems: 1,
            items: { enum: compressions },
          },
          limits: {
            type: 'object',
            additionalProperties: false,
            properties: {
              raw: thresholdSchema,
              gzip: thresholdSchema,
              brotli: thresholdSchema,
            },
          },
          ratchet: {
            type: 'object',
            additionalProperties: false,
            properties: {
              raw: ratchetSchema,
              gzip: ratchetSchema,
              brotli: ratchetSchema,
            },
          },
          badge: {
            type: 'object',
            additionalProperties: false,
            properties: {
              label: { type: 'string' },
              compression: { enum: compressions },
              colors: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  ok: { type: 'string' },
                  warn: { type: 'string' },
                  error: { type: 'string' },
                },
              },
              thresholds: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  warn_above: { type: 'integer', minimum: 0 },
                  error_above: { type: 'integer', minimum: 0 },
                },
              },
            },
          },
        },
      },
    },
    resolvers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'root'],
        properties: {
          type: { const: 'workspace-packages' },
          root: { type: 'string', minLength: 1 },
          dist_dir: { type: 'string' },
          include: {
            type: 'array',
            minItems: 1,
            items: { type: 'string' },
          },
          exclude: {
            type: 'array',
            items: { type: 'string' },
          },
          compressions: {
            type: 'array',
            minItems: 1,
            items: { enum: compressions },
          },
          limits: {
            type: 'object',
            additionalProperties: false,
            properties: {
              raw: thresholdSchema,
              gzip: thresholdSchema,
              brotli: thresholdSchema,
            },
          },
          ratchet: {
            type: 'object',
            additionalProperties: false,
            properties: {
              raw: ratchetSchema,
              gzip: ratchetSchema,
              brotli: ratchetSchema,
            },
          },
          badge: {
            type: 'object',
            additionalProperties: false,
            properties: {
              label: { type: 'string' },
              compression: { enum: compressions },
              colors: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  ok: { type: 'string' },
                  warn: { type: 'string' },
                  error: { type: 'string' },
                },
              },
              thresholds: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  warn_above: { type: 'integer', minimum: 0 },
                  error_above: { type: 'integer', minimum: 0 },
                },
              },
            },
          },
          id_prefix: { type: 'string' },
        },
      },
    },
  },
  anyOf: [{ required: ['targets'] }, { required: ['resolvers'] }],
} as const

const ajv = new Ajv({ allErrors: true })
const validateConfig = ajv.compile(schema)

export const DEFAULT_COMMENT_TEMPLATE = `{{{marker}}}
## gh-build-size

| Target | {{base_header}} | {{head_header}} | +/- |
| --- | ---: | ---: | ---: |
{{#rows}}
| {{{label}}} | {{base}} | {{current}} | {{delta}} |
{{/rows}}

{{#has_violations}}
### Violations
{{#violations}}
- {{label}} ({{compression}}): {{message}}
{{/violations}}
{{/has_violations}}

---
Reported by [gh-build-size](https://github.com/kitsuyui/gh-build-size)`

export function getInputs(): ActionInputs {
  return {
    githubToken: core.getInput('github-token', { required: true }),
    configPath: core.getInput('config-path') || '.github/gh-build-size.yml',
    defaultBranch: core.getInput('default-branch') || undefined,
    publishBranch: core.getInput('publish-branch') || undefined,
    commentKey: core.getInput('comment-key') || undefined,
    outputDir: core.getInput('output-dir') || '.gh-build-size',
  }
}

export async function loadConfig(configPath: string): Promise<ActionConfig> {
  const absolutePath = path.resolve(configPath)
  const raw = await fs.readFile(absolutePath, 'utf8')
  const parsed = absolutePath.endsWith('.json')
    ? JSON.parse(raw)
    : YAML.parse(raw)

  if (!validateConfig(parsed)) {
    throw new Error(
      `Invalid config: ${JSON.stringify(validateConfig.errors, null, 2)}`,
    )
  }

  return parsed as ActionConfig
}

function normalizeTarget(
  target: TargetConfig,
): TargetConfig & { label: string; compressions: Compression[] } {
  return {
    ...target,
    label: target.label ?? target.id,
    compressions: target.compressions ?? ['raw', 'gzip', 'brotli'],
  }
}

function slugifyTargetId(value: string): string {
  return value
    .replace(/^@/, '')
    .replaceAll('/', '-')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

function workspacePackageTarget(
  resolver: WorkspacePackagesResolverConfig,
  packageDir: string,
): TargetConfig {
  const packageName = path.posix.basename(packageDir)
  const distDir = path.posix.join(packageDir, resolver.dist_dir ?? 'dist')
  const include = resolver.include ?? ['**/*']

  return {
    id: `${resolver.id_prefix ?? 'pkg'}-${slugifyTargetId(packageName)}`,
    label: packageName,
    files: include.map((pattern) => path.posix.join(distDir, pattern)),
    exclude: resolver.exclude?.map((pattern) =>
      path.posix.join(distDir, pattern),
    ),
    compressions: resolver.compressions,
    limits: resolver.limits,
    ratchet: resolver.ratchet,
    badge: resolver.badge,
  }
}

async function expandResolvers(
  resolvers: WorkspacePackagesResolverConfig[],
  workspaceRoot: string,
): Promise<TargetConfig[]> {
  const targets: TargetConfig[] = []

  for (const resolver of resolvers) {
    const packageJsonPaths = await fg(
      path.posix.join(resolver.root, '*/package.json'),
      {
        cwd: workspaceRoot,
        onlyFiles: true,
      },
    )

    for (const packageJsonPath of packageJsonPaths.sort()) {
      const packageDir = path.posix.dirname(packageJsonPath)
      targets.push(workspacePackageTarget(resolver, packageDir))
    }
  }

  return targets
}

export async function normalizeConfig(
  config: ActionConfig,
  inputs: ActionInputs,
  workspaceRoot = process.cwd(),
): Promise<NormalizedConfig> {
  const expandedTargets = await expandResolvers(
    config.resolvers ?? [],
    workspaceRoot,
  )
  const normalizedTargets = [...(config.targets ?? []), ...expandedTargets].map(
    normalizeTarget,
  )

  return {
    defaultBranch: inputs.defaultBranch ?? config.default_branch,
    comment: {
      enabled: config.comment?.enabled ?? true,
      key: inputs.commentKey ?? config.comment?.key ?? 'default',
      template: config.comment?.template ?? DEFAULT_COMMENT_TEMPLATE,
    },
    publish: {
      enabled: config.publish?.enabled ?? false,
      branch: inputs.publishBranch ?? config.publish?.branch ?? 'gh-build-size',
      directory: config.publish?.directory ?? '.',
      summary_filename: config.publish?.summary_filename ?? 'summary.json',
      files_filename: config.publish?.files_filename ?? 'files.json',
      report_filename: config.publish?.report_filename ?? 'report.md',
      badges_directory: config.publish?.badges_directory ?? 'badges',
      targets_directory: config.publish?.targets_directory ?? 'targets',
    },
    targets: normalizedTargets,
  }
}
