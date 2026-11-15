/** Outcome tallies and failure grouping for the one-time V4 Session migration. */

import type { MigrationFailureDiagnostic } from './migration-failure-summary.ts'

/** Counts of migration outcomes, in total and per source version. */
export interface OutcomeCounts {
  converted: number
  alreadyV4: number
  failed: number
  skipped: number
}

/** Generation version an input declared, or `unknown` before its header was read. */
export type SourceVersion = number | 'unknown'

/** One failure recorded against an input path. */
export interface Failure extends MigrationFailureDiagnostic {
  inputPath: string
  sourceVersion: SourceVersion
}

/** Failures sharing a source version, reason, and diagnostic identity. */
export interface FailureGroup extends Pick<MigrationFailureDiagnostic, 'reason' | 'errorName' | 'eventType' | 'member' | 'child'> {
  sourceVersion: SourceVersion
  count: number
  items: Array<MigrationFailureDiagnostic & { inputPath: string }>
}

/**
 * Create a zeroed outcome tally.
 * @returns counts with every outcome at zero.
 */
export function emptyCounts(): OutcomeCounts {
  return { converted: 0, alreadyV4: 0, failed: 0, skipped: 0 }
}

/**
 * Group recorded failures by version and diagnostic identity, ordered by their grouping key.
 * @param failures - failures recorded during the run.
 * @returns groups sorted by key, each holding items sorted by input path.
 */
export function summarizeFailures(failures: readonly Failure[]): FailureGroup[] {
  const groups = new Map<string, FailureGroup>()
  for (const { sourceVersion, ...item } of failures) {
    const key = JSON.stringify([
      String(sourceVersion), item.reason, item.errorName, item.eventType ?? null, item.member ?? null, item.child ?? false,
    ])
    let group = groups.get(key)
    if (group === undefined) {
      group = {
        sourceVersion, reason: item.reason, errorName: item.errorName,
        ...item.eventType === undefined ? {} : { eventType: item.eventType },
        ...item.member === undefined ? {} : { member: item.member },
        ...item.child === undefined ? {} : { child: item.child },
        count: 0, items: [],
      }
      groups.set(key, group)
    }
    group.count += 1
    group.items.push(item)
  }
  return [...groups].sort(([left], [right]) => left.localeCompare(right)).map(([, group]) => ({
    ...group, items: group.items.sort((left, right) => left.inputPath.localeCompare(right.inputPath)),
  }))
}
