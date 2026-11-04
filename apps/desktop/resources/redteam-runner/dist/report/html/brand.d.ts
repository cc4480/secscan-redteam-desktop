/** The inlined brand mark (crosshair). Artwork: apps/desktop/resources/icon.svg. */
export declare const BRAND_MARK_SVG: string;
/** The cover's brand row: the mark plus the SecScan RedTeam wordmark. */
export declare function brandRow(): string;
/** One fleet seat's line on the report's team section. `summary` is
 * the seat's contribution to this engagement; absent renders the
 * role alone. */
export interface TeamMember {
    agent: string;
    seat: string;
    role: string;
    summary?: string;
}
/** The engagement team: every fleet seat that ran, its role, and its
 * contribution — rendered after the posture banner. */
export declare function teamSection(team: TeamMember[]): string;
