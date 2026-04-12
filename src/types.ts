export type Compression = 'raw' | 'gzip' | 'brotli'

export interface ThresholdConfig {
  max_bytes?: number
  fail?: boolean
}

export interface RatchetConfig {
  no_increase?: boolean
  fail?: boolean
}

export interface BadgeThresholds {
  warn_above?: number
  error_above?: number
}

export interface BadgeColors {
  ok?: string
  warn?: string
  error?: string
}

export interface BadgeConfig {
  label?: string
  compression?: Compression
  colors?: BadgeColors
  thresholds?: BadgeThresholds
}

export interface TargetConfig {
  id: string
  label?: string
  files: string[]
  exclude?: string[]
  compressions?: Compression[]
  limits?: Partial<Record<Compression, ThresholdConfig>>
  ratchet?: Partial<Record<Compression, RatchetConfig>>
  badge?: BadgeConfig
}

export interface WorkspacePackagesResolverConfig {
  type: 'workspace-packages'
  root: string
  dist_dir?: string
  include?: string[]
  exclude?: string[]
  compressions?: Compression[]
  limits?: Partial<Record<Compression, ThresholdConfig>>
  ratchet?: Partial<Record<Compression, RatchetConfig>>
  badge?: BadgeConfig
  id_prefix?: string
}

export interface PublishConfig {
  enabled?: boolean
  branch?: string
  directory?: string
  summary_filename?: string
  files_filename?: string
  report_filename?: string
  badges_directory?: string
  targets_directory?: string
}

export interface CommentConfig {
  enabled?: boolean
  key?: string
  template?: string
}

export interface ActionConfig {
  version?: number
  default_branch?: string
  comment?: CommentConfig
  publish?: PublishConfig
  targets?: TargetConfig[]
  resolvers?: WorkspacePackagesResolverConfig[]
}

export interface ActionInputs {
  githubToken: string
  configPath: string
  defaultBranch?: string
  publishBranch?: string
  commentKey?: string
  outputDir: string
}

export interface FileSnapshot {
  path: string
  sizes: Record<Compression, number>
}

export interface TargetSnapshot {
  id: string
  label: string
  files: FileSnapshot[]
  totals: Record<Compression, number>
}

export interface FilesSnapshot {
  generated_at: string
  repository: string
  default_branch: string
  publish_branch: string | null
  event_name: string
  head_reference: string
  files: FileSnapshot[]
}

export interface SizeViolation {
  compression: Compression
  kind: 'limit' | 'no_increase'
  message: string
  fail: boolean
}

export interface SizeValueStatus {
  current: number
  base: number | null
  delta: number | null
}

export interface TargetStatus {
  id: string
  label: string
  files: string[]
  touched_files: string[]
  baseline_missing: boolean
  commentable: boolean
  sizes: Record<Compression, SizeValueStatus>
  violations: SizeViolation[]
  badge_path: string
  target_path: string
}

export interface SummaryStatus {
  generated_at: string
  repository: string
  default_branch: string
  publish_branch: string | null
  event_name: string
  base_label: string
  base_reference: string | null
  head_label: string
  head_reference: string
  targets: TargetStatus[]
}

export interface NormalizedConfig {
  defaultBranch?: string
  comment: Required<CommentConfig>
  publish: Required<PublishConfig>
  targets: Array<
    TargetConfig & {
      label: string
      compressions: Compression[]
    }
  >
}
