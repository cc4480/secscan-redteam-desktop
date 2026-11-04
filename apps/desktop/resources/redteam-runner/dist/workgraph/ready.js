/**
 * The one ready-order comparator, exported so both sort sites use it and
 * can never drift: earliest deadline first, no-deadline tasks last, then
 * priority ascending. With no deadlines anywhere it degenerates to
 * exactly the historical priority sort.
 */
export function compareReadyTasks(a, b) {
    if (a.deadline !== undefined && b.deadline !== undefined && a.deadline !== b.deadline) {
        return a.deadline < b.deadline ? -1 : 1;
    }
    if (a.deadline !== undefined && b.deadline === undefined)
        return -1;
    if (a.deadline === undefined && b.deadline !== undefined)
        return 1;
    return a.priority - b.priority;
}
//# sourceMappingURL=ready.js.map