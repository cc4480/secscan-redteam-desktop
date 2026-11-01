/**
 * Gold Loop persisted state (loop-state.json in the Foundry store):
 * the cycle counter, the latest cycle summary, and the fitness table.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteFile } from './store.js';
/**
 * Load the loop state; absent state reads as zero cycles (a store path
 * under a non-directory is absent too — no state file can exist there,
 * and runLoopCycle's never-throws contract relies on the distinction).
 * A state file that exists but cannot be read, parsed, or recognized
 * fails loud instead: reading it as zero lets the next saveLoopState
 * overwrite the real cycle history (counter + fitness table) with a
 * fresh state, and reused cycle numbers corrupt the loop's bookkeeping.
 * Mirrors the registry treatment in store.ts.
 *
 * @param storeDir - the foundry store directory
 * @returns the persisted loop state (zero state when the file is absent)
 */
export function loadLoopState(storeDir) {
    const path = join(storeDir, 'loop-state.json');
    let text;
    try {
        text = readFileSync(path, 'utf8');
    }
    catch (err) {
        const code = err.code;
        if (code === 'ENOENT' || code === 'ENOTDIR')
            return { cyclesRun: 0, lastCycle: null, fitness: {} };
        throw new Error(`[foundry] loop state at ${path} could not be read: ${err instanceof Error ? err.message : String(err)}`);
    }
    let raw;
    try {
        raw = JSON.parse(text);
    }
    catch (err) {
        throw new Error(`[foundry] loop state at ${path} is not valid JSON — refusing to read it as zero cycles: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!raw || typeof raw.cyclesRun !== 'number') {
        throw new Error(`[foundry] loop state at ${path} has an unrecognized shape (no numeric cyclesRun) — refusing to read it as zero cycles`);
    }
    return { cyclesRun: raw.cyclesRun, lastCycle: raw.lastCycle ?? null, fitness: raw.fitness ?? {} };
}
/**
 * Persist the loop state atomically.
 *
 * @param storeDir - the foundry store directory
 * @param state - the state to write
 * @returns nothing
 */
export function saveLoopState(storeDir, state) {
    mkdirSync(storeDir, { recursive: true });
    atomicWriteFile(join(storeDir, 'loop-state.json'), JSON.stringify(state, null, 2) + '\n');
}
//# sourceMappingURL=loop-state.js.map