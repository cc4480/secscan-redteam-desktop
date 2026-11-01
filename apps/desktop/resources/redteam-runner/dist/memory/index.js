/**
 * Memory tiering (Q-MEMTIER) — public surface.
 *
 * A file-native, scope-bound memory for the fleet: L2 originals in an
 * append-only ledger, L0/L1 as generated views, trust derived from
 * proof (never asserted), two-phase commit with a named-human approval
 * gate, and recall that fails loud. See README.md in this directory.
 */
export { MemoryError, MemoryArchiveError } from "./errors.js";
export { resolveMemoryPaths, unitUri, archiveUri, diffUri } from "./paths.js";
export { canonicalize, hashRecord, sha256OfText, computeUnitId, sealUnit, verifyUnitHash, sealDiff, verifyDiffHash, validateUnit, validateDiff, parseUnitLine, } from "./schema.js";
export { deriveMemoryScope, assertScopeBinding, scopeEligible, scopeKeyForHosts, scopeKeyForClass, GLOBAL_SCOPE_KEY, normalizeHost, hostMatchesScope, } from "./scope.js";
export { deriveTrust, evaluateCorroboration, sourceKeyFor, TRUST_BASE_SCORES } from "./trust.js";
export { collapseCandidates, scoreCandidates, SOURCE_POOLS, DEFAULT_PACK_BUDGET } from "./collapse.js";
export { assembleMemoryPack, renderMemoryPack, decayFactor } from "./recall.js";
export { openMemoryStore, reindexMemoryStore, finalizeUnit } from "./store.js";
export { ensureViews, generateUnitViews, renderUnitMarkdown, refreshDirectoryView, VIEW_GENERATOR_VERSION } from "./views.js";
export { projectRegistryEntries, projectTrajectory, projectExperience, intakeTargetDerivedClaim, EXTRACTOR_VERSIONS, } from "./extract.js";
export { commitEngagementMemory } from "./commit.js";
export { readDiff, approveDiff, rejectDiff, applyDiff } from "./apply.js";
export { openEngagementMemory, deriveEngagementScope, injectStartMemory, injectExploitMemory, commitMemoryForRun, memoryStateFor, memoryDigestLine, recallStoreAdapter, resolveMemoryRootForRun, parseMemoryBudget, } from "./lifecycle.js";
export { runMemoryCommand, resolveMemoryRootFromEnv } from "./cli.js";
//# sourceMappingURL=index.js.map