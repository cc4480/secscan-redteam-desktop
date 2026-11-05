/**
 * The device brief: what an agent is looking at, and which tools belong to it.
 *
 * The device templates said which tools each class uses; the rules said how hard
 * to push. Neither reached an agent, because nothing resolved a device class at
 * runtime. This module does both: it decides which systems an engagement covers
 * and renders the tool set, the evidence bar and the rules for each of them, so an
 * agent knows what to reach for instead of guessing from a flat tool catalogue.
 */
import type { PromptContext } from '../prompts/shared.js';
import { type DeviceId } from './catalog.js';
/**
 * Which device classes this engagement covers.
 *
 * A local-host engagement is whatever machine it runs on; a full-battery run covers
 * every selected battery; a plain web engagement is the webapp class.
 *
 * @param ctx - The prompt context.
 * @returns The device classes, in a stable order.
 */
export declare function resolveDeviceClasses(ctx: PromptContext): DeviceId[];
/**
 * Render the device brief for an engagement.
 *
 * @param ctx - The prompt context.
 * @returns Markdown, or an empty string when nothing could be resolved.
 */
export declare function deviceBriefText(ctx: PromptContext): string;
