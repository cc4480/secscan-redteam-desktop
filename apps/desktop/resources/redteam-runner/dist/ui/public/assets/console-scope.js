/* Ops Console — Scope & Safety view (Phase 5, view 4).
 *
 * Read-only render of GET /api/console/scope: every refusal the dispatcher
 * recorded (scope, policy, hook, authorization) and every halt (per-target
 * auto-halt, engagement halt by reason, operator abort) across the most
 * recent engagements. The headline number is the denial total: each of
 * those calls was refused inside dispatch before any handler ran, so zero
 * packets left the machine for them.
 *
 * Registration: the console shell calls window.ConsoleViews.scope(body),
 * and the view contract also exposes { id, title, render } — so the render
 * function itself carries those properties.
 */
"use strict";

(function () {
  const { esc, pill, fmtTime, fmtNum, card, table } = window.ConsoleUtil;

  const KIND_PILLS = {
    scope_violation: ["scope violation", "bad"],
    policy_denied: ["policy denied", "warn"],
    hook_denied: ["hook denied", "warn"],
    scope_authorization_denied: ["authorization denied", "bad"],
    target_auto_halt: ["target auto-halt", "violet"],
    engagement_halted: ["engagement halted", "info"],
    abort_engagement: ["operator abort", "info"],
  };

  const HALT_REASON_LABELS = {
    action_cap: "Action cap reached",
    duration_cap: "Duration cap reached",
    target_distress_5xx: "Target distress — three consecutive 5xx",
    operator_abort: "Operator abort (kill switch)",
    coordinator_abort: "Coordinator abort",
    signoff_withheld: "Sign-off withheld (fail closed)",
    other: "Other recorded reason",
  };

  function statCard(label, value) {
    return card("", `<div class="oc-stat">${fmtNum(value)}</div><div class="oc-stat-label">${esc(label)}</div>`);
  }

  function kindPill(kind) {
    const hit = KIND_PILLS[kind];
    return hit ? pill(hit[0], hit[1]) : pill(String(kind || "event"), "muted");
  }

  async function render(el) {
    const data = await window.ConsoleApi.get("/api/console/scope");
    if (!data || data.available === false) {
      el.innerHTML = card(
        "Scope & Safety",
        `<p class="oc-muted">${esc((data && data.reason) || "Scope & safety data is not available.")}</p>`
      );
      return;
    }
    const t = data.totals || {};

    const stats = [
      statCard("Scope violations", t.scopeViolations),
      statCard("Policy denials", t.policyDenials),
      statCard("Hook denials", t.hookDenials),
      statCard("Authorizations refused", t.authorizationDenied),
      statCard("Target auto-halts", t.targetAutoHalts),
      statCard("Engagement halts", t.engagementHalts),
    ].join("");

    const zeroPacket = card(
      "",
      `<div class="oc-stat">${fmtNum(t.denials)}</div>` +
        `<div class="oc-stat-label">Refused calls — attacks that never left the machine</div>` +
        `<p class="oc-muted">Every refusal above was decided inside dispatch, before any tool handler ran. ` +
        `For each of these calls, zero packets were sent to any target.</p>`
    );

    const kindRows = [
      ["Scope violations", fmtNum(t.scopeViolations)],
      ["Policy denials", fmtNum(t.policyDenials)],
      ["Hook denials", fmtNum(t.hookDenials)],
      ["Authorizations refused (pre-start)", fmtNum(t.authorizationDenied)],
      ["Target auto-halts (distress)", fmtNum(t.targetAutoHalts)],
      ["Engagement halts", fmtNum(t.engagementHalts)],
      ["Operator aborts recorded", fmtNum(t.aborts)],
    ];
    const kindsCard = card("Counts by kind", table(["Kind", "Count"], kindRows.map(([a, b]) => [esc(a), esc(b)])));

    const reasonRows = (data.haltReasons || []).map((r) => [
      esc(HALT_REASON_LABELS[r.reason] || r.reason),
      fmtNum(r.count),
    ]);
    const reasonsCard = card(
      "Engagement halts by reason",
      reasonRows.length ? table(["Reason", "Count"], reasonRows) : `<p class="oc-muted">No engagement halts recorded.</p>`
    );

    const engRows = (data.perEngagement || [])
      .filter((e) => e.total > 0)
      .map((e) => [
        `<code>${esc(e.id)}</code>`,
        esc(e.target || "—"),
        fmtNum(e.denials),
        fmtNum(e.halts),
        fmtNum(e.total),
      ]);
    const engCard = card(
      `Per engagement (${fmtNum(data.window && data.window.engagementsScanned)} most recent scanned)`,
      engRows.length
        ? table(["Engagement", "Target", "Denials", "Halts", "Total"], engRows)
        : `<p class="oc-muted">No denials or halts in the scanned engagements.</p>`
    );

    const recRows = (data.latest || []).map((r) => [
      esc(fmtTime(r.ts)),
      `<code>${esc(r.engagementId)}</code>`,
      kindPill(r.kind),
      r.target ? `<code>${esc(r.target)}</code>` : "—",
      esc(r.reason || ""),
    ]);
    const latestCard = card(
      "Latest records",
      recRows.length
        ? table(["Time", "Engagement", "Kind", "Target host", "Reason"], recRows)
        : `<p class="oc-muted">No refusal or halt records found.</p>`
    );

    const notes = (data.notes || []).map((n) => `<div>${esc(n)}</div>`).join("");
    el.innerHTML =
      `<div class="oc-grid">${stats}</div>` +
      zeroPacket +
      `<div class="oc-grid">${kindsCard}${reasonsCard}</div>` +
      engCard +
      latestCard +
      (notes ? `<div class="oc-note">${notes}</div>` : "");
  }

  window.ConsoleViews.scope = Object.assign(render, {
    id: "scope",
    title: "Scope & Safety",
    render,
  });
})();
