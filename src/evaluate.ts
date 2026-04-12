import type {
  Compression,
  NormalizedConfig,
  SizeViolation,
  TargetSnapshot,
  TargetStatus,
} from './types'

const compressions: Compression[] = ['raw', 'gzip', 'brotli']

function buildViolations(
  target: NormalizedConfig['targets'][number],
  current: TargetSnapshot,
  base: TargetSnapshot | undefined,
): SizeViolation[] {
  const violations: SizeViolation[] = []

  for (const compression of target.compressions) {
    const currentValue = current.totals[compression]
    const baseValue = base?.totals[compression]
    const limit = target.limits?.[compression]
    if (limit?.max_bytes !== undefined && currentValue > limit.max_bytes) {
      violations.push({
        compression,
        kind: 'limit',
        message: `${currentValue} B exceeds limit ${limit.max_bytes} B`,
        fail: limit.fail ?? false,
      })
    }
    const ratchet = target.ratchet?.[compression]
    if (
      ratchet?.no_increase &&
      baseValue !== undefined &&
      currentValue > baseValue
    ) {
      violations.push({
        compression,
        kind: 'no_increase',
        message: `${currentValue} B increased from ${baseValue} B`,
        fail: ratchet.fail ?? false,
      })
    }
  }

  return violations
}

export function evaluateTargets(
  config: NormalizedConfig,
  currentSnapshots: TargetSnapshot[],
  baseSnapshots: TargetSnapshot[],
  touchedFilesByTarget: Map<string, string[]>,
  isPullRequest: boolean,
): TargetStatus[] {
  return config.targets.map((target) => {
    const current = currentSnapshots.find((item) => item.id === target.id)
    if (!current) {
      throw new Error(`Missing current snapshot for target "${target.id}"`)
    }
    const base = baseSnapshots.find((item) => item.id === target.id)
    const touchedFiles = touchedFilesByTarget.get(target.id) ?? []
    const commentable = !isPullRequest || touchedFiles.length > 0
    const violations = buildViolations(target, current, base)
    const sizes = {
      raw: {
        current: current.totals.raw,
        base: base?.totals.raw ?? null,
        delta:
          base?.totals.raw === undefined
            ? null
            : current.totals.raw - base.totals.raw,
      },
      gzip: {
        current: current.totals.gzip,
        base: base?.totals.gzip ?? null,
        delta:
          base?.totals.gzip === undefined
            ? null
            : current.totals.gzip - base.totals.gzip,
      },
      brotli: {
        current: current.totals.brotli,
        base: base?.totals.brotli ?? null,
        delta:
          base?.totals.brotli === undefined
            ? null
            : current.totals.brotli - base.totals.brotli,
      },
    }

    for (const compression of compressions) {
      if (!target.compressions.includes(compression)) {
        sizes[compression] = {
          current: 0,
          base: null,
          delta: null,
        }
      }
    }

    return {
      id: target.id,
      label: target.label,
      files: current.files,
      touched_files: touchedFiles,
      commentable,
      sizes,
      violations,
      badge_path: '',
      target_path: '',
    }
  })
}

export function countFailingViolations(targets: TargetStatus[]): number {
  return targets.reduce(
    (count, target) =>
      count + target.violations.filter((violation) => violation.fail).length,
    0,
  )
}
