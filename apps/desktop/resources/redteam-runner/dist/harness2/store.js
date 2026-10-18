/**
 * Harness2 store (H2-P1, spec section 5).
 *
 * One WAL-mode SQLite database under DSH_HARNESS2_ROOT holds every ingested
 * run in the three section-5 tables: `runs` (target metadata + harness
 * identity), `steps` (the full prompt/tool/observation trajectory, text never
 * truncated) and `metrics` (the ground truth: success, findings, claims, cost,
 * failure mode). node:sqlite is built into the bundled Node 24, so this adds no
 * dependency; the store refuses to create its database outside the configured
 * root.
 *
 * Schema, DDL and the v1 -> v2 migration live in ./store-schema.ts; row shapes,
 * section-5 derivation rules and SQL-row mapping in ./store-model.ts and
 * ./store-rows.ts; ingestion in ./ingest.ts, ./ingest-rows.ts and ./walk.ts.
 * This file owns the connection, the migration driver and the queries.
 */
import { mkdirSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { resolveHarness2Paths } from "./contract.js";
import { bundleFromRecord, eventsToSteps, integer, rowToClassStat, rowToFailureModeStat, rowToRun, rowToStep, } from "./store-rows.js";
import { INSERT_STEP, MIGRATE_METRICS, MIGRATE_RUNS, MIGRATE_STEPS, SCHEMA, SCHEMA_VERSION, SELECT_RUN, STATS_BY_CLASS, STATS_BY_FAILURE_MODE, STATS_TOTALS, UPSERT_METRICS, UPSERT_RUN, V1_TABLES, hasColumn, tableExists, } from "./store-schema.js";
/**
 * Open (and lazily create) the store. The database must live inside
 * `paths.root`, so a malformed DSH_HARNESS2_ROOT cannot scatter files elsewhere
 * on the box. WAL is enabled before anything is written; migrate() runs on open
 * and is idempotent.
 */
export function openHarness2Store(paths = resolveHarness2Paths()) {
    const root = resolve(paths.root);
    const database = resolve(paths.database);
    if (database !== root && !database.startsWith(root + sep)) {
        throw new Error(`[harness2] database ${database} would be written outside root ${root}`);
    }
    mkdirSync(root, { recursive: true });
    mkdirSync(dirname(database), { recursive: true });
    const db = new DatabaseSync(database);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");
    function readSchemaVersion() {
        return integer(db.prepare("PRAGMA user_version").get() ?? {}, "user_version");
    }
    function stampVersion() {
        db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    }
    /**
     * v1 -> v2 (pre-production migration): rename the old tables, create the
     * section-5 schema, copy runs -> runs+metrics and events -> steps, drop the
     * v1 tables (components/outcomes have no section-5 home). One transaction, so
     * a failure leaves the v1 database untouched.
     */
    function migrateV1() {
        db.exec("BEGIN");
        try {
            for (const table of V1_TABLES) {
                if (tableExists(db, `v1_${table}`))
                    db.exec(`DROP TABLE v1_${table}`);
                else if (tableExists(db, table))
                    db.exec(`ALTER TABLE ${table} RENAME TO v1_${table}`);
            }
            db.exec(SCHEMA);
            if (tableExists(db, "v1_runs")) {
                db.exec(MIGRATE_RUNS);
                db.exec(MIGRATE_METRICS);
                if (tableExists(db, "v1_events"))
                    db.exec(MIGRATE_STEPS);
            }
            for (const table of V1_TABLES) {
                if (tableExists(db, `v1_${table}`))
                    db.exec(`DROP TABLE v1_${table}`);
            }
            stampVersion();
            db.exec("COMMIT");
        }
        catch (err) {
            db.exec("ROLLBACK");
            throw err;
        }
    }
    function migrate() {
        const version = readSchemaVersion();
        if (version > SCHEMA_VERSION) {
            throw new Error(`[harness2] database schema v${version} is newer than this code (v${SCHEMA_VERSION})`);
        }
        const legacy = version === 1 ||
            (version === 0 && tableExists(db, "runs") && hasColumn(db, "runs", "engagement_id") && !hasColumn(db, "runs", "ts"));
        if (legacy) {
            migrateV1();
            return;
        }
        if (version === SCHEMA_VERSION)
            return;
        // Fresh file, or a v2-shaped file missing only its stamp: create the
        // schema idempotently in one transaction (one fsync instead of one per DDL
        // statement, which matters on a pulled-back E: drive).
        db.exec("BEGIN");
        try {
            db.exec(SCHEMA);
            stampVersion();
            db.exec("COMMIT");
        }
        catch (err) {
            db.exec("ROLLBACK");
            throw err;
        }
    }
    function insertStepsRaw(runId, steps, offset = 0) {
        const stmt = db.prepare(INSERT_STEP);
        steps.forEach((step, index) => {
            stmt.run({
                run_id: runId,
                seq: offset + index + 1,
                role: step.role,
                tool_name: step.toolName ?? null,
                content: step.content,
                tokens: step.tokens ?? null,
            });
        });
    }
    function upsertRows(bundle, steps) {
        if (bundle.runId === "")
            throw new Error("[harness2] a run needs a non-empty run_id");
        const runParams = {
            run_id: bundle.runId,
            ts: bundle.ts,
            target_class: bundle.targetClass === "" ? "unknown" : bundle.targetClass,
            target_subclass: bundle.targetSubclass ?? null,
            target_id: bundle.targetId ?? null,
            harness_version: bundle.harnessVersion === "" ? "unknown" : bundle.harnessVersion,
            layer_set: JSON.stringify(bundle.layerSet),
            cycle_ref: bundle.cycleRef ?? null,
        };
        const metricParams = {
            run_id: bundle.runId,
            success: bundle.success ? 1 : 0,
            vulns_found: bundle.vulnsFound,
            claims_total: bundle.claimsTotal,
            false_positives: bundle.falsePositives,
            steps_count: bundle.stepsCount,
            tokens_total: bundle.tokensTotal,
            crashed: bundle.crashed ? 1 : 0,
            failure_mode: bundle.failureMode,
        };
        db.exec("BEGIN");
        try {
            // INSERT OR REPLACE on the parent cascades the old steps/metrics away.
            db.prepare(UPSERT_RUN).run(runParams);
            db.prepare(UPSERT_METRICS).run(metricParams);
            insertStepsRaw(bundle.runId, steps);
            db.exec("COMMIT");
        }
        catch (err) {
            db.exec("ROLLBACK");
            throw err;
        }
        const detail = getRun(bundle.runId);
        if (detail === null)
            throw new Error(`[harness2] run ${bundle.runId} vanished after upsert`);
        return detail.run;
    }
    function upsertRun(record, steps) {
        return upsertRows(bundleFromRecord(record), steps ?? eventsToSteps(record.events));
    }
    function appendSteps(runId, steps) {
        const row = db.prepare("SELECT COALESCE(MAX(seq), 0) AS max_seq FROM steps WHERE run_id = ?").get(runId) ?? {};
        db.exec("BEGIN");
        try {
            insertStepsRaw(runId, steps, integer(row, "max_seq"));
            db.exec("COMMIT");
        }
        catch (err) {
            db.exec("ROLLBACK");
            throw err;
        }
        return steps.length;
    }
    function listRuns(filter = {}) {
        const clauses = [];
        const params = [];
        if (filter.targetClass !== undefined && filter.targetClass !== "") {
            clauses.push("r.target_class = ?");
            params.push(filter.targetClass);
        }
        const mode = "COALESCE(m.failure_mode, 'none')";
        if (filter.outcome === "success")
            clauses.push("m.success = 1");
        else if (filter.outcome === "aborted")
            clauses.push("m.crashed = 1");
        else if (filter.outcome === "failure")
            clauses.push(`m.success = 0 AND m.crashed = 0 AND ${mode} <> 'none'`);
        else if (filter.outcome === "partial")
            clauses.push(`m.success = 0 AND m.crashed = 0 AND ${mode} = 'none'`);
        const limit = Math.min(Math.max(Math.trunc(filter.limit ?? 50), 1), 10000);
        const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
        const rows = db
            .prepare(`${SELECT_RUN}${where} ORDER BY r.ts DESC, r.run_id ASC LIMIT ${limit}`)
            .all(...params);
        return rows.map(rowToRun);
    }
    function getRun(runId) {
        const raw = db.prepare(`${SELECT_RUN} WHERE r.run_id = ?`).get(runId);
        if (raw === undefined)
            return null;
        const steps = db.prepare("SELECT * FROM steps WHERE run_id = ? ORDER BY seq ASC").all(runId);
        return { run: rowToRun(raw), steps: steps.map(rowToStep) };
    }
    function runStats() {
        const totals = db.prepare(STATS_TOTALS).get() ?? {};
        const classRows = db.prepare(STATS_BY_CLASS).all();
        const modeRows = db.prepare(STATS_BY_FAILURE_MODE).all();
        return {
            total: integer(totals, "runs"),
            successes: integer(totals, "successes"),
            crashed: integer(totals, "crashed"),
            totalVulns: integer(totals, "vulns_found"),
            totalClaims: integer(totals, "claims_total"),
            totalFalsePositives: integer(totals, "false_positives"),
            totalSteps: integer(totals, "steps_count"),
            totalTokens: integer(totals, "tokens_total"),
            byTargetClass: classRows.map(rowToClassStat),
            byFailureMode: modeRows.map(rowToFailureModeStat),
        };
    }
    function close() {
        if (db.isOpen)
            db.close();
    }
    const store = {
        paths,
        migrate,
        upsertRun,
        upsertRows,
        listRuns,
        getRun,
        appendSteps,
        runStats,
        close,
    };
    migrate();
    return store;
}
// Ingestion is split across modules to keep every file inside the 300-line
// budget; re-exported here so callers only ever import the store module.
export { ingestEngagementDir } from "./ingest.js";
export { ingestRoot } from "./walk.js";
export { rowToRun, rowToStep, eventsToSteps, bundleFromRecord, runBundleFromJson } from "./store-rows.js";
export { SCHEMA, SCHEMA_VERSION } from "./store-schema.js";
//# sourceMappingURL=store.js.map