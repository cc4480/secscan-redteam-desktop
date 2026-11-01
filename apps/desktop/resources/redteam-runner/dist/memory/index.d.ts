/**
 * Memory tiering (Q-MEMTIER) — public surface.
 *
 * A file-native, scope-bound memory for the fleet: L2 originals in an
 * append-only ledger, L0/L1 as generated views, trust derived from
 * proof (never asserted), two-phase commit with a named-human approval
 * gate, and recall that fails loud. See README.md in this directory.
 */
export { MemoryError, MemoryArchiveError, type MemoryErrorCode } from "./errors.js";
export type { MemoryUnit, MemoryScope, TrustBlock, TrustTier, MemoryDiff, DiffOp, MemoryApprovalRecord, MemoryApplyReceipt, MemoryEngagementReceipt, MemoryEngagementState, MemoryPackResult, RecallReceipt, } from "./types.js";
export { resolveMemoryPaths, unitUri, archiveUri, diffUri, type MemoryPaths } from "./paths.js";
export { canonicalize, hashRecord, sha256OfText, computeUnitId, sealUnit, verifyUnitHash, sealDiff, verifyDiffHash, validateUnit, validateDiff, parseUnitLine, } from "./schema.js";
export { deriveMemoryScope, assertScopeBinding, scopeEligible, scopeKeyForHosts, scopeKeyForClass, GLOBAL_SCOPE_KEY, normalizeHost, hostMatchesScope, type ScopeEligibilityContext, } from "./scope.js";
export { deriveTrust, evaluateCorroboration, sourceKeyFor, TRUST_BASE_SCORES } from "./trust.js";
export { collapseCandidates, scoreCandidates, SOURCE_POOLS, DEFAULT_PACK_BUDGET } from "./collapse.js";
export { assembleMemoryPack, renderMemoryPack, decayFactor, type MemoryRecallStore, type AssemblePackOptions, type LegacyExperienceSlice } from "./recall.js";
export { openMemoryStore, reindexMemoryStore, finalizeUnit, type MemoryStore, type UnitDraft } from "./store.js";
export { ensureViews, generateUnitViews, renderUnitMarkdown, refreshDirectoryView, VIEW_GENERATOR_VERSION } from "./views.js";
export { projectRegistryEntries, projectTrajectory, projectExperience, intakeTargetDerivedClaim, EXTRACTOR_VERSIONS, type MemoryProposal, } from "./extract.js";
export { commitEngagementMemory, type MemoryCommitInput } from "./commit.js";
export { readDiff, approveDiff, rejectDiff, applyDiff } from "./apply.js";
export { openEngagementMemory, deriveEngagementScope, injectStartMemory, injectExploitMemory, commitMemoryForRun, memoryStateFor, memoryDigestLine, recallStoreAdapter, resolveMemoryRootForRun, parseMemoryBudget, type MemoryDeps, } from "./lifecycle.js";
export { runMemoryCommand, resolveMemoryRootFromEnv, type MemoryCliResult } from "./cli.js";
