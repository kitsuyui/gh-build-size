import type {
  Compression,
  FileSnapshot,
  FilesSnapshot,
  SizeValueStatus,
  SizeViolation,
  SummaryStatus,
  TargetSnapshot,
  TargetStatus,
} from './types'

export const CONFIG_SCHEMA_VERSION = 1
export const PUBLISHED_SCHEMA_VERSION = 1

const compressions = ['raw', 'gzip', 'brotli'] as const satisfies Compression[]
const violationKinds = ['limit', 'no_increase'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function readPublishedSchemaVersion(
  value: Record<string, unknown>,
): number | null {
  if (value.schema_version === undefined) {
    return PUBLISHED_SCHEMA_VERSION
  }
  return value.schema_version === PUBLISHED_SCHEMA_VERSION
    ? PUBLISHED_SCHEMA_VERSION
    : null
}

function isCompressionSizes(
  value: unknown,
): value is Record<Compression, number> {
  if (!isRecord(value)) {
    return false
  }
  return compressions.every(
    (compression) => typeof value[compression] === 'number',
  )
}

function normalizeSizeValueStatus(value: unknown): SizeValueStatus | null {
  if (!isRecord(value)) {
    return null
  }
  if (
    typeof value.current !== 'number' ||
    (value.base !== null && typeof value.base !== 'number') ||
    (value.delta !== null && typeof value.delta !== 'number')
  ) {
    return null
  }

  return {
    enabled:
      typeof value.enabled === 'boolean' ? value.enabled : value.current > 0,
    current: value.current,
    base: value.base,
    delta: value.delta,
  }
}

function normalizeTargetSizes(
  value: unknown,
): Record<Compression, SizeValueStatus> | null {
  if (!isRecord(value)) {
    return null
  }
  const sizes = Object.fromEntries(
    compressions.map((compression) => [
      compression,
      normalizeSizeValueStatus(value[compression]),
    ]),
  ) as Record<Compression, SizeValueStatus | null>
  if (compressions.some((compression) => sizes[compression] === null)) {
    return null
  }
  return sizes as Record<Compression, SizeValueStatus>
}

function isSizeViolation(value: unknown): value is SizeViolation {
  if (!isRecord(value)) {
    return false
  }
  return (
    compressions.includes(value.compression as Compression) &&
    violationKinds.includes(value.kind as SizeViolation['kind']) &&
    typeof value.message === 'string' &&
    typeof value.fail === 'boolean'
  )
}

function isFileSnapshot(value: unknown): value is FileSnapshot {
  if (!isRecord(value)) {
    return false
  }
  return typeof value.path === 'string' && isCompressionSizes(value.sizes)
}

function normalizeTargetStatus(value: unknown): TargetStatus | null {
  if (!isRecord(value)) {
    return null
  }
  const sizes = normalizeTargetSizes(value.sizes)
  if (
    typeof value.id !== 'string' ||
    typeof value.label !== 'string' ||
    !isStringArray(value.files) ||
    !isStringArray(value.touched_files) ||
    typeof value.baseline_missing !== 'boolean' ||
    typeof value.commentable !== 'boolean' ||
    sizes === null ||
    !Array.isArray(value.violations) ||
    !value.violations.every(isSizeViolation) ||
    typeof value.badge_path !== 'string' ||
    typeof value.target_path !== 'string'
  ) {
    return null
  }

  return {
    id: value.id,
    label: value.label,
    files: value.files,
    touched_files: value.touched_files,
    baseline_missing: value.baseline_missing,
    commentable: value.commentable,
    sizes,
    violations: value.violations,
    badge_path: value.badge_path,
    target_path: value.target_path,
  }
}

export function normalizePublishedSummary(
  value: unknown,
): SummaryStatus | null {
  if (!isRecord(value)) {
    return null
  }
  const schemaVersion = readPublishedSchemaVersion(value)
  if (schemaVersion === null) {
    return null
  }
  const targets = Array.isArray(value.targets)
    ? value.targets.map(normalizeTargetStatus)
    : null
  if (
    typeof value.generated_at !== 'string' ||
    typeof value.repository !== 'string' ||
    typeof value.default_branch !== 'string' ||
    !isNullableString(value.publish_branch) ||
    typeof value.event_name !== 'string' ||
    typeof value.base_label !== 'string' ||
    !isNullableString(value.base_reference) ||
    typeof value.head_label !== 'string' ||
    typeof value.head_reference !== 'string' ||
    targets === null ||
    targets.some((target) => target === null)
  ) {
    return null
  }

  return {
    ...(value as Omit<SummaryStatus, 'schema_version'>),
    schema_version: schemaVersion,
    targets: targets as TargetStatus[],
  }
}

export function normalizePublishedFilesSnapshot(
  value: unknown,
): FilesSnapshot | null {
  if (!isRecord(value)) {
    return null
  }
  const schemaVersion = readPublishedSchemaVersion(value)
  if (schemaVersion === null) {
    return null
  }
  if (
    typeof value.generated_at !== 'string' ||
    typeof value.repository !== 'string' ||
    typeof value.default_branch !== 'string' ||
    !isNullableString(value.publish_branch) ||
    typeof value.event_name !== 'string' ||
    typeof value.head_reference !== 'string' ||
    !Array.isArray(value.files) ||
    !value.files.every(isFileSnapshot)
  ) {
    return null
  }

  return {
    ...(value as Omit<FilesSnapshot, 'schema_version'>),
    schema_version: schemaVersion,
  }
}

export function normalizePublishedTargetSnapshot(
  value: unknown,
): TargetSnapshot | null {
  if (!isRecord(value)) {
    return null
  }
  const schemaVersion = readPublishedSchemaVersion(value)
  if (schemaVersion === null) {
    return null
  }
  if (
    typeof value.id !== 'string' ||
    typeof value.label !== 'string' ||
    !Array.isArray(value.files) ||
    !value.files.every(isFileSnapshot) ||
    !isCompressionSizes(value.totals)
  ) {
    return null
  }

  return {
    ...(value as Omit<TargetSnapshot, 'schema_version'>),
    schema_version: schemaVersion,
  }
}
