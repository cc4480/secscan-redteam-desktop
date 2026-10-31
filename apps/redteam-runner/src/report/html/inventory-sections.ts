/**
 * Q-RP-11 — the host-inventory report sections (parity audit rows
 * 18–20): Host & Security Posture Inventory (§6), Filesystem Inventory
 * (§7), Sensitive Data & Credential Exposure (§8). Markup only — every
 * figure arrives from report/host-inventory.ts; counts printed here are
 * derived from the row arrays there, and a recorded-vs-derived
 * disagreement renders as a note, never a silent substitution.
 *
 * Absence rules mirror the detail sections: no artifact => these
 * functions are never called with data and the report is unchanged;
 * a failed artifact renders the failure panel; an optional block the
 * collector did not carry renders nothing, not an empty table. An
 * EMPTY required block (volumes/accounts/patches/software) renders
 * "Not collected" — the permanent fallback whenever collection is
 * declined or unavailable — never a claim that none exist.
 */
import {
  derivedTotals,
  reconcileInventory,
  type HostInventory,
  type HostInventoryArtifact,
  type InventoryRow,
} from "../host-inventory.js";
import { esc } from "./tokens.js";

/** Human byte size for inventory tables (1024-based, one decimal). */
export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  return `${u === 0 ? String(v) : v.toFixed(1)} ${units[u]}`;
}

function well(title: string, rows: InventoryRow[]): string {
  if (rows.length === 0) return "";
  const body = rows
    .map((r) => `<div class="wrow"><dt>${esc(r.label)}</dt><dd>${esc(r.value)}</dd></div>`)
    .join("");
  return `<div class="well"><h3>${esc(title)}</h3><dl>${body}</dl></div>`;
}

function table(head: string[], bodyRows: string[]): string {
  if (bodyRows.length === 0) return "";
  const th = head.map((h) => `<th>${esc(h)}</th>`).join("");
  return `<div class="tblwrap"><table class="act"><thead><tr>${th}</tr></thead><tbody>${bodyRows.join("")}</tbody></table></div>`;
}

function sub(title: string, inner: string): string {
  return inner ? `<h3 class="sub-title">${esc(title)}</h3>${inner}` : "";
}

/** The permanent fallback for a required block the channel did not
 * collect: an empty row array is NOT a measurement of zero. */
function notCollected(block: string): string {
  return `<p class="diff-note">Not collected — the ${esc(block)} block was not returned by the collection channel.</p>`;
}

/** §6 — system, volumes, accounts, patch level, Defender, remote-access
 * configuration, hardening, notable software (audit row 18). */
function postureSection(inv: HostInventory): string {
  const parts: string[] = [];
  parts.push(`<h2 class="sec-title">Host &amp; Security Posture Inventory</h2>`);
  parts.push(
    `<p class="sec-sub">Collected on-host by ${esc(inv.collector)} · ${esc(inv.hostname)} · ${esc(inv.collectedAt)}</p>`,
  );
  const wells = [
    well("System and hardware", inv.system),
    inv.defender ? well("Microsoft Defender", inv.defender) : "",
    inv.remoteConfig ? well("SMB / RDP / WinRM configuration", inv.remoteConfig) : "",
    inv.hardening ? well("UAC, LSA and authentication hardening", inv.hardening) : "",
  ].filter(Boolean);
  if (wells.length > 0) parts.push(`<div class="wells">${wells.join("")}</div>`);
  if (inv.system.length === 0) parts.push(notCollected("system and hardware"));

  parts.push(sub("Volumes", inv.volumes.length > 0 ? table(
    ["Volume", "File system", "Size", "Free"],
    inv.volumes.map((v) =>
      `<tr><td>${esc(v.name)}</td><td>${esc(v.fileSystem ?? "—")}</td>` +
      `<td>${v.sizeBytes !== undefined ? fmtBytes(v.sizeBytes) : "—"}</td>` +
      `<td>${v.freeBytes !== undefined ? fmtBytes(v.freeBytes) : "—"}</td></tr>`),
  ) : notCollected("volumes")));
  parts.push(sub("Local accounts, groups and privilege", inv.accounts.length > 0 ? table(
    ["Account", "Kind", "Enabled", "Groups"],
    inv.accounts.map((a) =>
      `<tr><td>${esc(a.name)}</td><td>${esc(a.kind)}</td>` +
      `<td>${a.enabled === undefined ? "—" : a.enabled ? "Yes" : "No"}</td>` +
      `<td>${esc((a.groups ?? []).join(", ") || "—")}</td></tr>`),
  ) : notCollected("accounts")));
  const patchHead = inv.patchLevel ? `<p class="sec-sub">${esc(inv.patchLevel)}</p>` : "";
  parts.push(sub("Patch level", patchHead + (inv.patches.length > 0 ? table(
    ["Hotfix", "Installed on"],
    inv.patches.map((p) => `<tr><td>${esc(p.id)}</td><td>${esc(p.installedOn ?? "—")}</td></tr>`),
  ) : notCollected("patches"))));
  if (inv.processes !== undefined) {
    parts.push(sub("Running processes", inv.processes.length > 0 ? table(
      ["Process", "PID", "User", "CPU %", "Memory %"],
      inv.processes.map((p) =>
        `<tr><td>${esc(p.name)}</td><td>${p.pid ?? "—"}</td><td>${esc(p.user ?? "—")}</td>` +
        `<td>${p.cpuPercent ?? "—"}</td><td>${p.memoryPercent ?? "—"}</td></tr>`),
    ) : notCollected("processes")));
  }
  parts.push(sub("Notable installed software", inv.software.length > 0 ? table(
    ["Software", "Version", "Publisher"],
    inv.software.map((s) =>
      `<tr><td>${esc(s.name)}</td><td>${esc(s.version ?? "—")}</td><td>${esc(s.publisher ?? "—")}</td></tr>`),
  ) : notCollected("software")));
  return parts.join("");
}

/** §7 — filesystem inventory (audit row 19). Renders only when the
 * collector carried the block. */
function filesystemSection(inv: HostInventory): string {
  const fs = inv.filesystem;
  if (!fs) return "";
  const parts: string[] = [`<h2 class="sec-title">Filesystem Inventory</h2>`];
  if (fs.coverage) parts.push(`<p class="sec-sub">${esc(fs.coverage)}</p>`);
  parts.push(sub("Totals by volume", table(
    ["Volume", "Files", "Size"],
    fs.totalsByVolume.map((t) =>
      `<tr><td>${esc(t.volume)}</td><td>${t.files}</td><td>${fmtBytes(t.bytes)}</td></tr>`),
  )));
  parts.push(sub("File categories", table(
    ["Category", "Files", "Size"],
    fs.categories.map((c) =>
      `<tr><td>${esc(c.category)}</td><td>${c.files}</td><td>${fmtBytes(c.bytes)}</td></tr>`),
  )));
  parts.push(sub("Largest directories", table(
    ["Directory", "Size"],
    fs.largestDirectories.map((d) => `<tr><td>${esc(d.path)}</td><td>${fmtBytes(d.bytes)}</td></tr>`),
  )));
  parts.push(sub("Largest files", table(
    ["File", "Size"],
    fs.largestFiles.map((f) => `<tr><td>${esc(f.path)}</td><td>${fmtBytes(f.bytes)}</td></tr>`),
  )));
  parts.push(sub("Recently modified executables and scripts", table(
    ["File", "Modified"],
    fs.recentExecutables.map((f) => `<tr><td>${esc(f.path)}</td><td>${esc(f.modifiedAt)}</td></tr>`),
  )));
  return parts.join("");
}

/** §8 — sensitive data & credential exposure, presence only (row 20). */
function sensitiveSection(inv: HostInventory): string {
  const s = inv.sensitive;
  if (!s) return "";
  const parts: string[] = [`<h2 class="sec-title">Sensitive Data &amp; Credential Exposure</h2>`];
  parts.push(`<p class="sec-sub">Presence and counts only — no file contents or secret values are collected or printed.</p>`);
  parts.push(sub("Sensitive file categories discovered", table(
    ["Category", "Files"],
    s.categories.map((c) => `<tr><td>${esc(c.category)}</td><td>${c.files}</td></tr>`),
  )));
  parts.push(sub("High-signal credential and secret locations", table(
    ["Location", "Present", "Note"],
    s.credentialLocations.map((l) =>
      `<tr><td>${esc(l.location)}</td><td>${l.present ? "Yes" : "No"}</td><td>${esc(l.note ?? "—")}</td></tr>`),
  )));
  parts.push(sub("Credential stores", table(
    ["Store", "Entries"],
    s.stores.map((st) => `<tr><td>${esc(st.store)}</td><td>${st.entries}</td></tr>`),
  )));
  return parts.join("");
}

/**
 * The inventory block for one engagement. `undefined` (no artifact)
 * renders nothing at all; a failed artifact renders the honest panel;
 * an ok artifact renders §§6–8 with the derived-count line and any
 * reconciliation notes.
 */
export function inventorySection(artifact: HostInventoryArtifact | undefined): string {
  if (artifact === undefined) return "";
  if (artifact.status === "failed") {
    const where = artifact.hostname ? ` for ${esc(artifact.hostname)}` : "";
    return (
      `<h2 class="sec-title">Host &amp; Security Posture Inventory</h2>` +
      `<div class="panelbox"><p>Local inventory collection${where} did not complete: ${esc(artifact.error)} ` +
      `No inventory is shown for this engagement — the absence is the record, not a clean result.</p></div>`
    );
  }
  const inv = artifact.inventory;
  const t = derivedTotals(inv);
  // A zero derived from an EMPTY required array is "not collected",
  // never a measured zero (coordinator ruling, 2026-10-31). Files are
  // collected only when the filesystem block carries volume rows.
  const filesCollected = (inv.filesystem?.totalsByVolume.length ?? 0) > 0;
  const countParts = [
    inv.volumes.length > 0 ? `${t.volumes} volumes` : "volumes not collected",
    inv.accounts.length > 0 ? `${t.accounts} accounts` : "accounts not collected",
    inv.patches.length > 0 ? `${t.patches} hotfixes` : "hotfixes not collected",
    inv.software.length > 0 ? `${t.software} software entries` : "software not collected",
    filesCollected ? `${t.files} files inventoried` : "files not collected",
  ];
  const countLine = `<p class="accuracy">${countParts.join(" · ")}</p>`;
  const notes = reconcileInventory(inv)
    .map((n) => `<p class="diff-note">Count reconciliation — ${esc(n)}. Section counts are derived from the inventory rows.</p>`)
    .join("");
  return postureSection(inv) + countLine + notes + filesystemSection(inv) + sensitiveSection(inv);
}
