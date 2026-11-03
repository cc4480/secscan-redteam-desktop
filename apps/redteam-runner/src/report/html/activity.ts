/**
 * Report activity projection — extracted from wire.ts to keep the wiring
 * module under the 300-line budget. Pure: events in, activity rows out.
 */
import { type EngagementEvent } from '../../types.js'
import {
  projectApprovals,
  projectDanglingCauses,
  projectToolStats,
} from '../../events/projections.js'
import { type ActivityInput } from './render.js'

export function buildActivity(events: EngagementEvent[]): ActivityInput {
  const stats = projectToolStats(events)
  return {
    eventCount: events.length,
    rows: stats.slice(0, 40).map(s => ({
      action: s.action,
      count: s.count,
      attackIds: s.attackIds,
      firstSeq: s.firstSeq,
      lastSeq: s.lastSeq,
    })),
    totalActions: stats.length,
    decisions: projectApprovals(events).map(e => ({ action: e.action, seq: e.seq })),
    danglingCauses: projectDanglingCauses(events),
  }
}
