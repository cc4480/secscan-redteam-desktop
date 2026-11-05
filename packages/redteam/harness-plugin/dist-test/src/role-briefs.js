/**
 * Fleet role-brief loader: assembles each team member's spawn brief from the
 * doctrine files under the package-root `agents/` directory.
 *
 * Mirrors the llm-router charter loader (../llm-router/src/charter/loader.ts):
 * runtime readFileSync (tsc does not copy .md assets), candidate paths
 * derived from this module's location walking up, a dedicated error type,
 * fail-loud on any missing/unreadable/empty asset, and a per-process cache.
 * The directory is a parameter, never configuration — tests point the loader
 * at fixture directories; there is no env var, settings surface, or reload.
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REDTEAM_PROFILE } from './redteam-profile.js';
export class FleetBriefError extends Error {
    constructor(message) {
        super(message);
        this.name = 'FleetBriefError';
    }
}
/**
 * Candidate `agents/` directories, nearest first. The module sits one level
 * below the package root in `src/` and in `lib/` output, two levels below in
 * `dist-test/src/` test output; the walk covers those layouts plus a future
 * flat one. A candidate only counts when it actually contains
 * `_shared-base.md` — a bare directory hit is not proof it is the right one.
 */
export function fleetAgentsDirCandidates() {
    const here = dirname(fileURLToPath(import.meta.url));
    return [
        join(here, '..', 'agents'),
        join(here, '..', '..', 'agents'),
        join(here, '..', '..', '..', 'agents'),
        join(here, 'agents'),
    ];
}
/** The first candidate that exists and contains the shared base, else throw. */
export function defaultFleetAgentsDir() {
    const candidates = fleetAgentsDirCandidates();
    for (const candidate of candidates) {
        if (existsSync(join(candidate, '_shared-base.md')))
            return candidate;
    }
    throw new FleetBriefError(`fleet agents directory not found; searched: ${candidates.join(', ')}`);
}
/**
 * Read one role file from the agents directory, trimmed. The file name is a
 * bare name, never a path — directory prefixes are reduced to the basename,
 * because profile values are package-root-relative ('agents/recon.md') and
 * the loader has already resolved the directory itself.
 */
export function loadRoleFile(fileName, dir = defaultFleetAgentsDir()) {
    const path = join(dir, basename(fileName));
    let text;
    try {
        text = readFileSync(path, 'utf8');
    }
    catch (err) {
        throw new FleetBriefError(`fleet role file unreadable: ${path} (${err instanceof Error ? err.message : String(err)})`);
    }
    const trimmed = text.trim();
    if (trimmed.length === 0) {
        throw new FleetBriefError(`fleet role file empty: ${path}`);
    }
    return trimmed;
}
/** The shared base every brief stands on. */
export function loadSharedBase(dir = defaultFleetAgentsDir()) {
    return loadRoleFile('_shared-base.md', dir);
}
/**
 * The bare file name for a profile member. Profile `promptFile` values are
 * package-root-relative paths; only the basename is meaningful once the
 * agents directory is resolved. Unknown names throw — a silent miss here is
 * the unconsumed-field disease this loader exists to cure.
 */
export function promptFileFor(memberName) {
    const member = REDTEAM_PROFILE.members.find(candidate => candidate.name === memberName);
    if (!member) {
        throw new FleetBriefError(`unknown fleet member: ${memberName}`);
    }
    return basename(member.promptFile);
}
/** One member's assembled brief: shared base, one blank line, the role file. */
export function assembledBrief(memberName, dir = defaultFleetAgentsDir()) {
    return `${loadSharedBase(dir)}\n\n${loadRoleFile(promptFileFor(memberName), dir)}`;
}
const briefsCache = new Map();
/** Assembled briefs for every profile member, cached once per process. */
export function fleetBriefs(dir = defaultFleetAgentsDir()) {
    const cached = briefsCache.get(dir);
    if (cached)
        return cached;
    const briefs = new Map();
    for (const member of REDTEAM_PROFILE.members) {
        briefs.set(member.name, assembledBrief(member.name, dir));
    }
    briefsCache.set(dir, briefs);
    return briefs;
}
