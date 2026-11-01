/**
 * Campaign types (Q-CAMPAIGN, scoping N1).
 *
 * A campaign sits ABOVE engagements: one wave = one engagement launched
 * with the campaign's accumulated state as its starting context. The
 * campaign record is the persistent entity that outlives any single run —
 * it binds the ONE verified scope every wave inherits, the campaign caps,
 * the wave history, and every operator decision (receipts, not prose).
 *
 * Knowledge (findings, lessons, recall) is NOT stored here — that is
 * Q-MEMTIER's substrate. This record stores plan, sequence, and intent
 * only: what waves exist, what each one did, and who approved what.
 *
 * Schema agreed in the pair build log before either half built on it
 * (campaign-build-log-2026-10-31.md). Validation lives in schema.ts;
 * persistence in store.ts; the operator-decision gate in gate.ts.
 */
export {};
//# sourceMappingURL=types.js.map