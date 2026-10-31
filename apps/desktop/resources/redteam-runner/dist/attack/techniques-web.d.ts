/**
 * Web-focused ATT&CK techniques (the original catalog). Host techniques
 * live in techniques-host.ts; catalog.ts assembles TECHNIQUES in order.
 */
import type { EngagementPhase } from "../types.js";
export type NoiseLevel = "low" | "medium" | "high";
export interface AttackTechnique {
    id: string;
    name: string;
    tactic: string;
    /** Which runner phases may use it. */
    phases: EngagementPhase[];
    /** Relative likelihood of tripping a defender. Drives black-mode choices. */
    noise: NoiseLevel;
    description: string;
    /** OWASP reference where the technique covers a web flaw class. */
    owasp?: string;
}
declare const WEB_TECHNIQUES: AttackTechnique[];
export { WEB_TECHNIQUES };
