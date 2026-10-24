/* Ops Console shell (Phase 5) — tab host + shared helpers for the views.
 *
 * View modules (console-<name>.js, loaded after this file) register a render
 * function on window.ConsoleViews.<name>. A view whose script has not landed
 * yet shows a muted "view not installed" panel — the page never breaks on a
 * missing registration. The console is read-only: views only GET.
 */
"use strict";

window.ConsoleViews = window.ConsoleViews || {};

window.ConsoleApi = {
  async get(path) {
    const res = await fetch(path, { credentials: "same-origin" });
    if (res.status === 401) {
      location.href = "/?login=1";
      throw new Error("unauthorized");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },
};

window.ConsoleUtil = {
  esc(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  },
  /* Status pill. kind: ok | warn | bad | info | violet | muted. */
  pill(label, kind) {
    const kinds = ["ok", "warn", "bad", "info", "violet", "muted"];
    const k = kinds.includes(kind) ? kind : "muted";
    return `<span class="oc-pill oc-pill-${k}">${window.ConsoleUtil.esc(label)}</span>`;
  },
  fmtTime(iso) {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
    } catch {
      return String(iso);
    }
  },
  fmtNum(n) {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
    return Number(n).toLocaleString();
  },
  card(title, bodyHtml) {
    const h = title ? `<h3>${window.ConsoleUtil.esc(title)}</h3>` : "";
    return `<div class="oc-card">${h}${bodyHtml || ""}</div>`;
  },
  /* headers: string[]; rows: string[][] of already-escaped cell HTML. */
  table(headers, rows) {
    if (!rows || !rows.length) return `<p class="oc-muted">Nothing to show.</p>`;
    const head = headers.map((h) => `<th>${window.ConsoleUtil.esc(h)}</th>`).join("");
    const body = rows
      .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
      .join("");
    return `<table class="oc-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  },
};

(function () {
  /* Build order from the Phase 5 design: layers, engagements, benchmark, scope. */
  const ORDER = [
    ["layers", "Layers & Gates"],
    ["engagements", "Engagements"],
    ["benchmark", "Benchmark"],
    ["scope", "Scope & Safety"],
  ];
  const esc = window.ConsoleUtil.esc;
  let active = "layers";
  let host = null;

  async function show(name) {
    active = name;
    if (!host) return;
    host.querySelectorAll("[data-oc-tab]").forEach((b) => {
      b.classList.toggle("active", b.dataset.ocTab === name);
    });
    const body = host.querySelector("#oc-body");
    const stamp = host.querySelector("#oc-stamp");
    const view = window.ConsoleViews[name];
    if (typeof view !== "function") {
      body.innerHTML = window.ConsoleUtil.card(
        "",
        `<p class="oc-muted">View not installed — the ${esc(name)} view module has not been loaded.</p>`
      );
    } else {
      body.innerHTML = window.ConsoleUtil.card("", `<p class="oc-muted">Loading…</p>`);
      try {
        await view(body);
      } catch (err) {
        body.innerHTML = window.ConsoleUtil.card(
          "",
          `<p class="oc-bad">${esc(err && err.message ? err.message : String(err))}</p>`
        );
      }
    }
    if (stamp) stamp.textContent = `data as of ${new Date().toLocaleTimeString()}`;
  }

  window.renderConsole = function (el) {
    host = el;
    const tabs = ORDER.map(
      ([name, label]) => `<button type="button" data-oc-tab="${name}">${esc(label)}</button>`
    ).join("");
    el.innerHTML = `<div class="oc">
      <div class="oc-head">
        <h2 class="oc-title">Ops Console</h2>
        <span class="oc-muted oc-small" id="oc-stamp"></span>
        <button type="button" class="oc-refresh" id="oc-refresh">Refresh</button>
      </div>
      <div class="oc-tabs">${tabs}</div>
      <div id="oc-body"></div>
    </div>`;
    el.querySelectorAll("[data-oc-tab]").forEach((b) => {
      b.onclick = () => show(b.dataset.ocTab);
    });
    const refresh = el.querySelector("#oc-refresh");
    if (refresh) refresh.onclick = () => show(active);
    return show(active);
  };
})();
