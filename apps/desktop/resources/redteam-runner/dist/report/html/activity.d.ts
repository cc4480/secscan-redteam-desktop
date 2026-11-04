/**
 * Report activity projection — extracted from wire.ts to keep the wiring
 * module under the 300-line budget. Pure: events in, activity rows out.
 */
import { type EngagementEvent } from '../../types.js';
import { type ActivityInput } from './render.js';
export declare function buildActivity(events: EngagementEvent[]): ActivityInput;
