import { type Ctx } from '../context.js';
import { type SignOffTransition } from './exploit-one.js';
export declare function coordinatorSignOff(ctx: Ctx, transition: SignOffTransition, payload: () => string, incompleteRounds?: number): Promise<void>;
