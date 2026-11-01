/**
 * Arsenal knowledge server — module barrel (spec §2: runner-internal).
 *
 * Integrator-owned (ARS-1): slice modules (tag-rules, collections-map,
 * ingest, fetch-guard, tools, refresh) export from their own files and are
 * wired in here as their steps land. The contracts this barrel freezes are
 * recorded in the crew build log (arsenal-build-log-2026-10-31.md).
 */
export * from './config.js';
export * from './index-store.js';
//# sourceMappingURL=index.js.map