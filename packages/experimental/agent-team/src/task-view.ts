/** Pure task-view derivation shared by the task board and the client projection. */

import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { TeamState } from './projection.ts'
import type {
  TeamTaskAttestation,
  TeamTaskAttestationView,
  TeamTaskSnapshot,
  TeamTaskView,
} from './types.ts'

/**
 * Whether two normalized file or directory prefixes overlap on path components.
 * @param left - normalized write scope.
 * @param right - normalized write scope.
 * @returns whether either scope contains the other.
 */
function scopesOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)
}

/**
 * Resolve one durable member identity to its model-facing name.
 * @param state - Team state supplying the roster and Lead identity.
 * @param id - member identity, or undefined for an absent optional owner.
 * @returns `lead` for the root, the roster name otherwise, or undefined when the identity names nobody.
 */
function memberName(state: TeamState, id: SessionId | undefined): string | undefined {
  if (id === undefined) return undefined
  return id === brandString<SessionId>(state.id)
    ? 'lead'
    : state.members.find(member => member.id === id)?.name
}

/**
 * Derive one attestation view, naming the member that recorded it.
 * @param state - Team state supplying the roster and Lead identity.
 * @param attestation - durable attestation to view.
 * @returns a detached attestation view.
 */
function projectAttestation(state: TeamState, attestation: TeamTaskAttestation): TeamTaskAttestationView {
  const byName = memberName(state, attestation.by)
  return {
    kind: attestation.kind,
    revision: attestation.revision,
    ...byName === undefined ? {} : { byName },
    ...attestation.reason === undefined ? {} : { reason: attestation.reason },
  }
}

/**
 * Whether every current blocker of one task completed.
 * @param state - Team state supplying sibling tasks.
 * @param task - durable task snapshot to test.
 * @returns whether the task has no incomplete blockers.
 */
export function taskReady(state: TeamState, task: TeamTaskSnapshot): boolean {
  return task.blockedBy.every(id => state.tasks.find(candidate => candidate.id === id)?.status === 'completed')
}

/**
 * Derive one task view with owner name, readiness, and advisory write overlaps.
 * A committing caller may pass its pre-append state because `task` supplies the
 * new value explicitly; owner names, blocker readiness, and other task scopes
 * do not change when that snapshot is appended.
 * @param state - Team state supplying members and sibling tasks.
 * @param task - durable task snapshot to view.
 * @returns a detached task view.
 */
export function projectTaskView(state: TeamState, task: TeamTaskSnapshot): TeamTaskView {
  const ownerName = memberName(state, task.ownerId)
  const warnings = new Set<string>()
  for (const other of state.tasks) {
    if (other.id === task.id || other.status !== 'in_progress') continue
    if (task.writeScopes.some(left => other.writeScopes.some(right => scopesOverlap(left, right)))) {
      warnings.add(`write scopes overlap with ${other.id}`)
    }
  }
  return {
    id: task.id,
    revision: task.revision,
    subject: task.subject,
    description: task.description,
    status: task.status,
    blockedBy: [...task.blockedBy],
    writeScopes: [...task.writeScopes],
    ...ownerName === undefined ? {} : { ownerName },
    ready: task.status === 'pending' && taskReady(state, task),
    writeScopeWarnings: [...warnings],
    // The attestation is shown exactly as recorded, revision included, so the
    // board never rewrites a member's own record to look more current than it is.
    ...task.attestation === undefined ? {} : { attestation: projectAttestation(state, task.attestation) },
  }
}
