/* Ops Console — Layers & Gates view (Phase 5, view 2).
 *
 * Read-only. Renders GET /api/console/layers: regression alerts pinned on
 * top, the active composition as ordered chips, the adopted-layers table
 * (TS harness + Python harness, source-tagged), the gate queue, and the
 * Python EXPERIENCE.md tail. Any section the API marks unavailable shows
 * its reason instead of data — the view never invents a value.
 *
 * Registration: the view is a callable render function carrying the
 * contract properties (id, title, render) so both the shell's
 * `view(body)` call and property-style consumers work.
 */
"use strict";

(function () {
  const { esc, pill, fmtTime, card, table } = window.ConsoleUtil;

  function sectionOrReason(title, section, renderBody) {
    if (!section || section.available !== true) {
      const reason = section && section.reason ? section.reason : "data source unavailable";
      return card(title, `<p class="oc-muted">Unavailable — ${esc(reason)}</p>`);
    }
    return card(title, renderBody(section));
  }

  function alertsHtml(section) {
    if (!section || section.available !== true) {
      const reason = section && section.reason ? section.reason : "data source unavailable";
      return card("Regression alerts", `<p class="oc-muted">Unavailable — ${esc(reason)}</p>`);
    }
    if (!section.items.length) {
      return card("Regression alerts", `<p class="oc-muted">No regression alerts. The monitor and incident logs are quiet.</p>`);
    }
    const rows = section.items.map((a) => {
      const sev = a.severity === "red" ? pill("alert", "bad") : pill("watch", "warn");
      const what = [a.layerId, a.targetClass].filter(Boolean).join(" · ");
      return `<div class="oc-alert oc-alert-${esc(a.severity)}">
        ${sev} <strong>${esc(a.kind)}</strong>
        ${what ? `<span>${esc(what)}</span>` : ""}
        <span class="oc-muted oc-small">${esc(fmtTime(a.ts))}</span>
        <div>${esc(a.detail)}</div>
      </div>`;
    });
    return card("Regression alerts", rows.join(""));
  }

  function compositionHtml(section) {
    return sectionOrReason("Active composition", section, (s) => {
      if (!s.activeIds.length) return `<p class="oc-muted">No active layers — the base harness runs unmodified.</p>`;
      const chips = s.activeIds
        .map((id, i) => pill(`${i + 1}. ${id}`, "violet"))
        .join(" ");
      const when = s.updatedAt ? `<p class="oc-muted oc-small">Manifest updated ${esc(fmtTime(s.updatedAt))} · later layers win</p>` : "";
      return `<div class="oc-chips">${chips}</div>${when}`;
    });
  }

  function layersHtml(section) {
    return sectionOrReason("Adopted layers", section, (s) => {
      const rows = s.items.map((l) => {
        const state = l.active
          ? pill(l.activeIndex ? `active #${l.activeIndex}` : "active", "ok")
          : l.status
            ? pill(l.status, "warn")
            : pill("installed", "muted");
        const base = l.baseline || l.evidence || "—";
        return [
          `<code>${esc(l.id)}</code>`,
          pill(l.source, l.source === "python" ? "info" : "violet"),
          esc(l.targetClass || "—"),
          esc(l.adoptedAt ? fmtTime(l.adoptedAt) : "—"),
          esc(base),
          l.shaShort ? `<code>${esc(l.shaShort)}</code>` : "—",
          state,
        ];
      });
      return table(["Layer", "Source", "Target class", "Adopted", "Baseline / evidence", "SHA", "State"], rows);
    });
  }

  function gateStatusPill(item) {
    if (item.adopted === true || item.status === "adopt") return pill(item.status, "ok");
    if (item.status === "reject" || item.status === "rejected") return pill(item.status, "bad");
    if (item.status === "awaiting probe" || item.status === "package generated" || String(item.status).startsWith("probed")) {
      return pill(item.status, "warn");
    }
    return pill(item.status, "muted");
  }

  function gateHtml(section) {
    return sectionOrReason("Gate queue", section, (s) => {
      const rows = s.items.map((g) => {
        const runs = g.baseRuns !== null && g.candidateRuns !== null
          ? `${g.baseRuns} base / ${g.candidateRuns} cand`
          : "—";
        const detail = g.reason ? `<div class="oc-small oc-muted">${esc(g.reason)}</div>` : "";
        return [
          `<code>${esc(g.id)}</code>${detail}`,
          esc(g.kind),
          esc(g.targetClass || "—"),
          gateStatusPill(g),
          esc(runs),
          esc(g.recordedAt ? fmtTime(g.recordedAt) : "—"),
        ];
      });
      return table(["Package", "Kind", "Target class", "Status", "Runs", "Recorded"], rows);
    });
  }

  function experienceHtml(section) {
    return sectionOrReason("Experience — Python harness (latest entries)", section, (s) => {
      if (!s.lines.length) return `<p class="oc-muted">EXPERIENCE.md is empty.</p>`;
      return `<pre class="oc-pre">${s.lines.map((l) => esc(l)).join("\n")}</pre>`;
    });
  }

  async function render(el) {
    el.innerHTML = card("", `<p class="oc-muted">Loading layers &amp; gates…</p>`);
    const data = await window.ConsoleApi.get("/api/console/layers");
    el.innerHTML = [
      alertsHtml(data.alerts),
      compositionHtml(data.composition),
      layersHtml(data.layers),
      gateHtml(data.gateQueue),
      experienceHtml(data.experience),
    ].join("");
  }

  render.id = "layers";
  render.title = "Layers & Gates";
  render.render = render;
  window.ConsoleViews = window.ConsoleViews || {};
  window.ConsoleViews.layers = render;
})();
