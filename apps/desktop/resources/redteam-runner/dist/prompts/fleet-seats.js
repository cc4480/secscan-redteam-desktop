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
 * Layer-2 skill bodies attached per seat: the skills whose tool families
 * the seat's phase actually drives (tools/compose.ts phase sets). Every
 * other skill stays Layer-1 (index only) until it triggers.
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