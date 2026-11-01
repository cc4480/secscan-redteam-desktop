import { type Ctx, type LiveFinding } from '../context.js';
import { type ActorRole, type EngagementPhase } from '../types.js';
import type { ToolCallRequest } from '@secscan/redteam-llm-router';
import { type DispatchResult } from './types.js';
import { type ScanVulnerability } from '#secscan/scanner.js';
/**
 * ScanVulnerability → LiveFinding, verbatim: severity and title carry
 * over unchanged, the scanner's category becomes the finding's vuln
 * class, and the evidence is the scanner's own evidence text (falling
 * back to its description when the check recorded no separate evidence
 * blob). No rewording, no re-grading — the engine's FP/FN tuning lives
 * in exactly these strings.
 */
export declare function scanVulnerabilityToFinding(v: ScanVulnerability, attackId: string): LiveFinding;
export declare function handleSecscanTools(ctx: Ctx, _role: ActorRole, _phase: EngagementPhase, call: ToolCallRequest, args: Record<string, unknown>): Promise<DispatchResult | null>;
