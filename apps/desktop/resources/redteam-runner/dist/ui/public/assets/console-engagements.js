/* Operator console — Engagements view (Phase 5, view 1).
 *
 * Read-only situational awareness over GET /api/console/engagements:
 * live engagement cards first, then a recent-history table. Rows and cards
 * click through to the existing engagement detail route (#/e/<id>).
 * Renders only what the API returns; null fields show as "—".
 */
"use strict";

window.ConsoleViews = window.ConsoleViews || {};

(function () {
  const U = window.ConsoleUtil || {};
  const esc =
    U.esc ||
    U.escapeHtml ||
    function (s) {
      return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    };
  const fmtTime =
    U.time ||
    U.fmtTime ||
    function (iso) {
      if (!iso) return "—";
      try {
        return new Date(iso).toLocaleString();
      } catch {
        return iso;
      }
    };
  const badge =
    U.statusBadge ||
    U.badge ||
    function (s) {
      return `<span class="badge ${esc(s)}">${esc(s)}</span>`;
    };
  const fmtNum =
    U.fmtNum ||
    function (n) {
      return n === null || n === undefined ? "—" : Number(n).toLocaleString();
    };

  function detailHref(id) {
    return `#/e/${encodeURIComponent(id)}`;
  }

  function provenText(f) {
    if (!f || f.total === 0) return "0 findings";
    const pct = f.provenShare === null || f.provenShare === undefined ? "—" : `${Math.round(f.provenShare * 100)}% PROVEN`;
    return `${f.total} finding${f.total === 1 ? "" : "s"} · ${f.proven} proven (${pct})`;
  }

  function tokensText(t) {
    if (!t) return "—";
    return `${fmtNum(t.total)} tok (${fmtNum(t.in)} in / ${fmtNum(t.out)} out)`;
  }

  function verdictText(v) {
    if (!v) return "";
    const parts = Object.keys(v.byDisposition)
      .sort()
      .map((k) => `${esc(k)} ${v.byDisposition[k]}`);
    return `<div class="small muted">Items: ${fmtNum(v.total)} — ${parts.join(" · ")}</div>`;
  }

  function layersText(l) {
    if (!l) return "";
    const ids = (l.ids || []).map(esc).join(", ") || "base profile";
    const comps = Object.keys(l.components || {})
      .map((k) => `${esc(k)} ${esc(l.components[k])}`)
      .join(" · ");
    return `<div class="small muted">Layers: ${ids}${comps ? `<br>Components: ${comps}` : ""}</div>`;
  }

  function stepsText(e) {
    const steps = e.steps === null || e.steps === undefined ? "—" : fmtNum(e.steps);
    return `${fmtNum(e.actions)} actions · ${steps} steps`;
  }

  function liveCard(e) {
    return `<div class="card">
      <div class="row">
        ${badge(e.status)}
        <strong><a href="${detailHref(e.id)}">${esc(e.target)}</a></strong>
        <span class="muted small">${esc(e.id)} · mode ${esc(e.mode)}</span>
      </div>
      <div class="row small" style="margin-top:8px">
        <span>Phase: ${esc(e.phase)}</span>
        <span>${stepsText(e)}</span>
        <span>${tokensText(e.tokens)}</span>
        <span>${esc(provenText(e.findings))}</span>
        <span class="muted">Started ${esc(fmtTime(e.startedAt))}</span>
        ${e.hasReport ? `<a href="${detailHref(e.id)}">report</a>` : ""}
      </div>
      ${e.error ? `<div class="small" style="color:var(--red)">${esc(e.error)}</div>` : ""}
      ${verdictText(e.verdicts)}
      ${layersText(e.layers)}
    </div>`;
  }

  function historyRow(e) {
    return `<tr data-id="${esc(e.id)}" style="cursor:pointer">
      <td>${esc(fmtTime(e.startedAt))}</td>
      <td><a href="${detailHref(e.id)}">${esc(e.target)}</a></td>
      <td>${badge(e.status)}</td>
      <td>${esc(e.phase)}</td>
      <td>${esc(provenText(e.findings))}</td>
      <td>${e.tokens ? fmtNum(e.tokens.total) : "—"}</td>
      <td>${e.steps === null || e.steps === undefined ? "—" : fmtNum(e.steps)}</td>
      <td class="muted">${e.source === "archive" ? "archive" : ""}</td>
    </tr>`;
  }

  async function render(el) {
    el.innerHTML = `<div class="card"><h3>Engagements</h3><p class="muted">Loading…</p></div>`;
    let data;
    try {
      data = await window.ConsoleApi.get("/api/console/engagements");
    } catch (err) {
      el.innerHTML = `<div class="card"><h3>Engagements</h3><p class="muted">Failed to load: ${esc(err && err.message ? err.message : err)}</p></div>`;
      return;
    }
    if (!data || data.available === false) {
      el.innerHTML = `<div class="card"><h3>Engagements</h3><p class="muted">${esc((data && data.reason) || "Engagement data is not available.")}</p></div>`;
      return;
    }
    const list = Array.isArray(data.engagements) ? data.engagements : [];
    if (list.length === 0) {
      el.innerHTML = `<div class="card"><h3>Engagements</h3><p class="muted">No engagements on disk yet.</p></div>`;
      return;
    }
    const live = list.filter((e) => e.live);
    const history = list.filter((e) => !e.live);
    let html = "";
    if (live.length > 0) {
      html += `<h3 style="margin:0 0 12px">Live now (${live.length})</h3>` + live.map(liveCard).join("");
    }
    if (history.length > 0) {
      html += `<div class="card"><h3>Recent history</h3><table>
        <thead><tr><th>Started</th><th>Target</th><th>Status</th><th>Phase</th><th>Findings</th><th>Tokens</th><th>Steps</th><th></th></tr></thead>
        <tbody>${history.map(historyRow).join("")}</tbody></table></div>`;
    }
    html += `<p class="muted small">Snapshot ${esc(fmtTime(data.generatedAt))} · read-only — launch and abort live in the engagement detail view.</p>`;
    el.innerHTML = html;
    Array.from(el.querySelectorAll("tr[data-id]")).forEach((tr) => {
      tr.addEventListener("click", () => {
        location.hash = detailHref(tr.dataset.id);
      });
    });
  }

  window.ConsoleViews.engagements = { id: "engagements", title: "Engagements", render };
})();
