/** Soul asset (prompts/souls/<name>.md in the fleet package) per seat. */
export const SOUL_BY_ROLE = {
    coordinator: 'morpheus',
    recon: 'operator',
    exploiter: 'neo',
    reporter: 'architect',
    coder: 'tank',
    publisher: 'scribe',
};
/**
 * Layer-2 skill bodies attached per seat, keyed by TARGET FAMILY in
 * `target-protocol.ts` — a Windows engagement binds AD/SMB/WinRM skills, an
 * Android engagement binds mobile analysis, a webapp binds web tooling. This
 * map is the DEFAULT (webapp/flat) set: it also seeds the asset loader, which
 * must read every family's bodies (see fleet-assembly.ts).
 */
export const SKILLS_BY_ROLE = {
    coordinator: ['redteam-ops-coordination'],
    recon: ['deep-research-osint', 'webapp-scan'],
    exploiter: ['webapp-exploit', 'browser-action-execution'],
    reporter: ['findings-grading-reporting', 'html-report-design'],
    coder: ['exploit-coding-toolbuilding'],
    publisher: ['findings-grading-reporting', 'html-report-design'],
};
//# sourceMappingURL=fleet-seats.js.map