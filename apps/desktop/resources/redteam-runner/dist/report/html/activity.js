import { projectApprovals, projectDanglingCauses, projectToolStats, } from '../../events/projections.js';
export function buildActivity(events) {
    const stats = projectToolStats(events);
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
    };
}
//# sourceMappingURL=activity.js.map