/* Ops Console — Benchmark view (Phase 5, view 3). Read-only.
 *
 * Renders the standing benchmark suite's own recorded output, served by
 * GET /api/console/benchmark: FP-regression callouts pinned on top (red),
 * the latest scored run as a per-target heat table, then the HISTORY.md
 * ledger table. When the API reports the benchmark dir as unavailable, the
 * view renders exactly that reason — a missing source shows as missing.
 */
"use strict";

(function () {
  const U = window.ConsoleUtil;
  const esc = U.esc;

  const HEAT = {
    ok: "background:rgba(63,185,80,.22)",
    warn: "background:rgba(210,153,34,.25)",
    bad: "background:rgba(248,81,73,.30)",
  };

  function heat(text, kind) {
    return `<span style="display:inline-block;min-width:2.4em;text-align:center;` +
      `padding:1px 7px;border-radius:4px;${HEAT[kind] || ""}">${esc(text)}</span>`;
  }

  function rate(v) {
    return typeof v === "number" ? v.toFixed(3) : "—";
  }

  function verdictCell(verdict) {
    switch (verdict) {
      case "FP_REGRESSION": return U.pill("FP REGRESSION", "bad");
      case "CLEAN": return U.pill("clean", "ok");
      case "ALL_PROVEN": return U.pill("all proven", "ok");
      case "PARTIAL": return U.pill("partial", "warn");
      case "NONE_PROVEN": return U.pill("none proven", "bad");
      default: return U.pill(String(verdict || "—"), "muted");
    }
  }

  function heatKind(t) {
    if (t.verdict === "FP_REGRESSION" || t.verdict === "NONE_PROVEN") return "bad";
    if (t.verdict === "PARTIAL") return "warn";
    return "ok";
  }

  function calloutsHtml(callouts) {
    if (!callouts || !callouts.length) return "";
    const parts = [];
    for (const c of callouts) {
      if (c.kind === "fp-regression") {
        parts.push(
          `<div style="border:1px solid rgba(248,81,73,.65);` +
          `background:rgba(248,81,73,.13);border-radius:6px;` +
          `padding:8px 12px;margin:0 0 8px">` +
          `<strong class="oc-bad">${esc(c.text)}</strong></div>`
        );
      }
    }
    for (const c of callouts) {
      if (c.kind === "delta") {
        parts.push(`<p class="oc-muted" style="margin:2px 0">Δ ${esc(c.text)}</p>`);
      }
    }
    return parts.length ? `<div style="margin-bottom:12px">${parts.join("")}</div>` : "";
  }

  function latestRunHtml(run) {
    if (!run) {
      return U.card("Latest scored run",
        `<p class="oc-muted">No scored results JSON found in the benchmark ` +
        `dir yet — score.py has not recorded a run here.</p>`);
    }
    const m = run.metrics || {};
    const meta =
      `<p class="oc-muted" style="margin-top:0">condition ` +
      `<strong>${esc(run.condition ?? "—")}</strong> · scored ` +
      `${esc(run.scoredOn ?? "—")} · file ${esc(run.file)} · base ` +
      `${esc(run.baseCondition ?? "—")}</p>`;
    const metrics =
      `<p style="margin:4px 0 10px">SR ${rate(m.sr)} · VF ${rate(m.vf)} · ` +
      `FPR ${rate(m.fpr)} · S ${rate(m.s)} · chain ✓ ${U.fmtNum(m.chainProven)} · ` +
      `refusal ✓ ${U.fmtNum(m.refusalProven)} · PROVEN share ${rate(m.provenShare)} · ` +
      `claims ${U.fmtNum(m.claimsTotal)} · FP ${U.fmtNum(m.fpTotal)} · ` +
      `scope violations ${U.fmtNum(m.scopeViolations)}</p>`;
    const rows = (run.targets || []).map((t) => [
      esc(t.id),
      esc(t.class),
      heat(`${t.findings}`, heatKind(t)),
      esc(String(t.expected)),
      esc(String(t.claims)),
      t.falsePositives > 0 ? heat(String(t.falsePositives), "bad")
        : esc(String(t.falsePositives)),
      verdictCell(t.verdict),
    ]);
    const table = U.table(
      ["Target", "Class", "Proven", "Expected", "Claims", "FP", "Verdict"], rows);
    return U.card("Latest scored run", meta + metrics + table);
  }

  function historyHtml(history) {
    const rows = (history && history.rows) || [];
    if (rows.length) {
      const tableRows = rows.map((r) => [
        esc(r.date), esc(r.condition), esc(r.versions), esc(r.sr), esc(r.vf),
        esc(r.fpr), esc(r.steps), esc(r.tok), esc(r.cr), esc(r.chain),
        esc(r.refusal), esc(r.provenShare), esc(r.notes),
      ]);
      return U.card("Benchmark history (HISTORY.md)",
        U.table(["Date", "Condition", "Code / layers", "SR", "VF", "FPR",
          "Steps", "TOK", "CR", "chain ✓", "refusal ✓", "PROVEN share",
          "Notes"], tableRows));
    }
    const md = history && history.markdown;
    const body = md
      ? `<p class="oc-muted">No scored runs recorded yet. Ledger as written:</p>` +
        `<pre class="oc-small" style="white-space:pre-wrap">${esc(md)}</pre>`
      : `<p class="oc-muted">HISTORY.md not found in the benchmark dir.</p>`;
    return U.card("Benchmark history (HISTORY.md)", body);
  }

  async function render(el) {
    const data = await window.ConsoleApi.get("/api/console/benchmark");
    if (!data || data.available === false) {
      /* Honest absence: render exactly the reason, nothing else. */
      el.innerHTML = U.card("",
        `<p class="oc-muted">${esc((data && data.reason) || "Benchmark data unavailable.")}</p>`);
      return;
    }
    el.innerHTML =
      calloutsHtml(data.callouts) +
      latestRunHtml(data.latestRun) +
      historyHtml(data.history);
  }

  /* The console shell invokes the registered view as a function, view(el);
   * the registration also carries the id/title/render fields. */
  const view = Object.assign(render, { id: "benchmark", title: "Benchmark", render });
  window.ConsoleViews.benchmark = view;
})();
