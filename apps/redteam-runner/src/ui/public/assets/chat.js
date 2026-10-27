/* Chat view — the home screen. The operator talks; the agent team works.
 *
 * A message names a target (a domain or URL). The chat confirms, then hands
 * the words to the same launch path the old form used (POST /api/engagements)
 * with the operator's text as the objective. Progress lives on the
 * engagement's live view (#/e/<id>). Past runs list under the chat.
 */
"use strict";

window.renderChat = function (el) {
  el.innerHTML = `
  <div class="chat-wrap">
    <div class="engine-banner" id="engine-banner">Checking which models the team is running…</div>
    <div class="chat-log" id="chat-log"></div>
    <form class="chat-input" id="chat-form">
      <input id="chat-text" autocomplete="off" placeholder="Tell the team what to hit — e.g. run a full pentest on secscan.us">
      <button type="submit">Send the team</button>
    </form>
    <div class="card chat-history"><h3>Past runs</h3><div id="chat-runs"><p class="muted">Loading…</p></div></div>
    <div class="card chat-foundry"><h3>Foundry</h3><div id="chat-foundry"><p class="muted">Loading…</p></div></div>
  </div>`;

  const log = el.querySelector("#chat-log");
  const form = el.querySelector("#chat-form");
  const input = el.querySelector("#chat-text");

  const bubble = (who, text) => {
    const d = document.createElement("div");
    d.className = `bubble ${who}`;
    d.textContent = text;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  };

  (async () => {
    try {
      const m = await api.get("/api/models");
      const active = (m.providers || []).find((p) => p.id === m.activeProvider);
      const seats = (m.seats || []).map((s) => `${s.role}: ${s.model}`).join(" · ");
      el.querySelector("#engine-banner").innerHTML =
        `Team engine: <strong>${esc(active ? active.label : m.activeProvider || "unknown")}</strong>` +
        (active ? (active.configured ? " — connected" : " — NOT connected") : "") +
        (seats ? `<div class="small muted">${esc(seats)}</div>` : "");
    } catch {
      el.querySelector("#engine-banner").textContent = "Team engine: could not check (is the runner up?)";
    }
  })();

  const loadRuns = async () => {
    const box = el.querySelector("#chat-runs");
    try {
      const list = await api.get("/api/engagements");
      if (!list.length) {
        box.innerHTML = `<p class="muted">No runs yet. Tell the team a target above.</p>`;
        return;
      }
      box.innerHTML = `<table><thead><tr><th>ID</th><th>Target</th><th>Status</th><th>Findings</th><th>Updated</th></tr></thead><tbody>` +
        list.map((e) => `<tr class="clickable" data-id="${esc(e.id)}">
          <td><code>${esc(e.id)}</code>${e.live ? ' <span class="badge running">live</span>' : ""}</td>
          <td>${esc(e.target)}</td><td>${statusBadge(e.status)}</td>
          <td>${e.findings}</td><td class="muted small">${esc(time(e.updatedAt))}</td></tr>`).join("") +
        `</tbody></table>`;
      box.querySelectorAll("tr.clickable").forEach((tr) => {
        tr.onclick = () => { location.hash = `#/e/${encodeURIComponent(tr.dataset.id)}`; };
      });
    } catch (err) {
      box.innerHTML = `<p style="color:var(--red)">${esc(err.message)}</p>`;
    }
  };
  loadRuns();

  const loadFoundry = async () => {
    const box = el.querySelector("#chat-foundry");
    try {
      const f = await api.get("/api/foundry");
      const snap = f.snapshot && f.snapshot.counts
        ? `${f.snapshot.counts.total} snapshot bundles (${f.snapshot.counts.gold} gold)`
        : "no snapshot located";
      const store = f.store && f.store.available
        ? `${f.store.cases.length} case(s), ${f.store.bundles.length} bundle(s) in the store`
        : "no store yet — the first completed run creates it";
      const cycles = f.loop ? f.loop.cyclesRun : 0;
      const latest = (f.store && f.store.cases || []).slice(-3).reverse()
        .map((c) => `<div class="small">🧬 ${esc(c.family)} · ${esc(c.tier)} · ${esc(c.id)}</div>`).join("");
      box.innerHTML =
        `<div>Snapshot: ${esc(snap)}</div><div>Store: ${esc(store)}</div>` +
        `<div>Gold Loop cycles run: ${cycles}</div>${latest}`;
    } catch (err) {
      box.innerHTML = `<p style="color:var(--red)">${esc(err.message)}</p>`;
    }
  };
  loadFoundry();

  bubble("team", "I'm here with the whole team. Give me a target — a domain or a URL — and what you want done. We take it from there.");

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    bubble("me", text);
    const m = text.match(/https?:\/\/[^\s]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s]*)?/i);
    if (!m) {
      bubble("team", "I need a target in there — a domain or URL, like secscan.us — then I can put the team on it.");
      return;
    }
    let target = m[0];
    let host = target;
    try { host = new URL(target.includes("://") ? target : `https://${target}`).hostname; } catch { /* keep raw */ }
    const ok = await confirmModal(
      "Send the team?",
      `<p>The team will run a live engagement against <code>${esc(host)}</code>:</p><p class="muted">${esc(text)}</p>`,
      "Send them",
      false,
    );
    if (!ok) {
      bubble("team", "Stood down. Nothing was sent.");
      return;
    }
    const working = bubble("team", "Putting the team on it…");
    try {
      const { id } = await api.post("/api/engagements", {
        target,
        mode: "red",
        objective: text,
        scope: [host],
        environment: "staging",
        tier: 1,
      });
      working.innerHTML = `Team is on it — engagement <code>${esc(id)}</code>. ` +
        `<a href="#/e/${encodeURIComponent(id)}">Watch it live</a>`;
      loadRuns();
    } catch (err) {
      working.textContent = `Couldn't launch: ${err.message}`;
    }
  };

  input.focus();
};
