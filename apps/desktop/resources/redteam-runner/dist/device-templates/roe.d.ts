/**
 * Per-device rules of engagement.
 *
 * The device templates (`catalog.ts`) say WHAT to use and what counts as proof.
 * This module says how hard the runner may push on each device class. The posture
 * is the same everywhere and it is deliberately permissive: inside the verified
 * perimeter, aggression is total — exploit, escalate, chain, mutate state when the
 * demonstration requires it. The rules below bound WHERE and WHAT, never how much
 * effort or creativity goes in.
 *
 * Two limits are mechanical and global, not per-device, and they are not timidity:
 *   - no denial of service / resource exhaustion — the target must be left standing;
 *   - no irreversible destruction (deleting data, disabling or locking the client's
 *     real accounts, changing their configuration) without the operator.
 */
import type { DeviceId } from './catalog.js';
/** Rules for one device class, rendered into the exploit prompt and the report. */
export interface DeviceRules {
    /** What full aggression looks like on this class. */
    aggression: readonly string[];
    /** The proof that counts here, and what may be changed to reach it. */
    proof: readonly string[];
    /** Class-specific limits. Never a ban on exploiting the class. */
    limits: readonly string[];
}
export declare const DEVICE_RULES: Record<DeviceId, DeviceRules>;
/**
 * Render one device class’s rules as a prompt/report block.
 * @param device - The device class.
 * @returns Markdown lines, or an empty string for an unknown class.
 */
export declare function renderDeviceRules(device: DeviceId): string;
