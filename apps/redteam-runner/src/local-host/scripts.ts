/**
 * Local host mode — tier-2 collection: four fixed read-only PowerShell
 * scripts, run through the paired bridge's `shell_pwsh` op.
 *
 * Why this tier exists (pair-log conflict flag + coordinator ruling,
 * 2026-10-31): the artifact contract requires volumes / accounts /
 * patches / software blocks, but the bridge's read-class ops enumerate
 * none of them — tier-0 alone can only emit those blocks empty. The
 * audit's objection to the old `/pcscan` was network services
 * (SMB/WinRM/SSH) and test credentials ON THE TARGET; local execution
 * through the operator's own paired agent needs neither, so the ruling
 * fills the four blocks for real through the channel that already exists.
 *
 * Binding properties:
 * - The scripts are FIXED STRINGS in this file. No model-supplied or
 *   engagement-supplied value is interpolated into them, ever — the
 *   collector sends `{ script, timeout_s }` and nothing else.
 * - Every cmdlet is read-only (Get-Volume, Get-LocalUser, Get-LocalGroup,
 *   Get-LocalGroupMember, Get-HotFix, Get-ItemProperty on the standard
 *   uninstall keys). Nothing in any script mutates the machine.
 * - The bridge's consent behavior is untouched: `shell_pwsh` raises
 *   whatever approval dialog the bridge raises, and a decline or timeout
 *   fails that one block (see collect.ts) — collection continues and the
 *   artifact records the block as not collected.
 * - The bridge caps returned stdout at its last 4000 characters, so an
 *   over-long result arrives as unparseable JSON. Parsing here is strict
 *   for exactly that reason: a block whose output does not parse whole
 *   is reported not collected, never partially — a truncated software
 *   list presented as complete would be a fabricated inventory.
 */
import type {
  LocalAccountRow,
  LocalPatchRow,
  LocalSoftwareRow,
  LocalVolumeRow,
} from "./types.js";

/** The bridge tool the tier-2 pass runs through. */
export const LOCAL_TIER2_TOOL = "shell_pwsh";

/** One fixed collection script and its bridge timeout. */
export interface LocalTier2Block {
  /** The exact script text sent to the bridge; never interpolated. */
  readonly script: string;
  /** Bridge `timeout_s` for the call (bridge default 60, cap 300). */
  readonly timeoutS: number;
}

/**
 * The four tier-2 blocks, in collection order. `String.raw` keeps the
 * scripts byte-exact (registry paths carry single backslashes).
 */
export const LOCAL_TIER2_BLOCKS = {
  volumes: {
    script: String.raw`Get-Volume | Where-Object { $null -ne $_.DriveLetter } | ForEach-Object { [PSCustomObject]@{ name = "$($_.DriveLetter):"; fileSystem = [string]$_.FileSystem; sizeBytes = [int64]$_.Size; freeBytes = [int64]$_.SizeRemaining } } | ConvertTo-Json -Compress`,
    timeoutS: 60,
  },
  accounts: {
    // Group membership is matched on SID, not on the "HOST\user" display
    // name, so no string surgery is involved. The nested scan is O(users
    // × groups) bridge-side; the timeout carries the headroom.
    script: String.raw`$rows = foreach ($u in (Get-LocalUser)) { $memberOf = @(); foreach ($g in (Get-LocalGroup)) { try { foreach ($m in (Get-LocalGroupMember -Group $g.Name -ErrorAction Stop)) { if ($m.SID -eq $u.SID) { $memberOf += $g.Name } } } catch { } }; [PSCustomObject]@{ name = [string]$u.Name; kind = 'local user'; enabled = [bool]$u.Enabled; groups = @($memberOf) } }; $rows | ConvertTo-Json -Compress -Depth 4`,
    timeoutS: 240,
  },
  patches: {
    script: String.raw`Get-HotFix | Sort-Object InstalledOn -Descending | ForEach-Object { [PSCustomObject]@{ id = [string]$_.HotFixID; installedOn = $(try { $_.InstalledOn.ToString('yyyy-MM-dd') } catch { [string]$_.InstalledOn }) } } | ConvertTo-Json -Compress`,
    timeoutS: 120,
  },
  software: {
    // The publisher key is present only when the entry carries one —
    // ConvertTo-Json omits it, and the parser defaults it absent.
    script: String.raw`$keys = @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'); Get-ItemProperty -Path $keys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } | ForEach-Object { $row = [ordered]@{ name = [string]$_.DisplayName; version = [string]$_.DisplayVersion }; if ($_.Publisher) { $row['publisher'] = [string]$_.Publisher }; [PSCustomObject]$row } | Sort-Object name | ConvertTo-Json -Compress`,
    timeoutS: 60,
  },
} as const satisfies Record<string, LocalTier2Block>;

/** The tier-2 block names, in collection order. */
export type LocalTier2BlockName = keyof typeof LOCAL_TIER2_BLOCKS;

/**
 * Reduce a `shell_pwsh` result to the script's stdout.
 *
 * The bridge answers with a `{ returncode, stdout, stderr }` envelope
 * (or `{ timed_out: true, ... }`); the runner's client hands the
 * collector that envelope serialized as JSON text. A nonzero exit, a
 * timeout, or an error envelope throws — the caller records the block as
 * not collected. A result that is not the envelope (a stub channel's raw
 * script output) is returned unchanged.
 * @param text - the channel's result text for one `shell_pwsh` call.
 * @returns the script's stdout.
 */
export function shellStdout(text: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return text;
  const record = parsed as Record<string, unknown>;
  if (typeof record["stdout"] !== "string") {
    if ("error" in record) {
      const error = record["error"];
      const message =
        typeof error === "string"
          ? error
          : error !== null && typeof error === "object" && typeof (error as { message?: unknown }).message === "string"
            ? (error as { message: string }).message
            : "bridge returned an error envelope";
      throw new Error(`shell_pwsh failed: ${message}`);
    }
    return text;
  }
  if (record["timed_out"] === true) throw new Error("shell_pwsh timed out on the bridge");
  const returncode = record["returncode"];
  if (typeof returncode === "number" && returncode !== 0) {
    const stderr = typeof record["stderr"] === "string" ? record["stderr"].trim() : "";
    throw new Error(
      `shell_pwsh exited ${String(returncode)}${stderr !== "" ? `: ${stderr.slice(0, 200)}` : ""}`,
    );
  }
  return record["stdout"];
}

/** Parse a script's JSON output: an array of row objects, or one object. */
function parseRowArray(text: string, block: string): Array<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `${block}: script output is not parseable JSON (the bridge caps stdout; an over-long result is reported not collected rather than partial)`,
    );
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows.map((row, i) => {
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`${block}: row ${String(i)} is not an object`);
    }
    return row as Record<string, unknown>;
  });
}

function requiredString(row: Record<string, unknown>, key: string, block: string): string {
  const value = row[key];
  if (typeof value !== "string" || value === "") {
    throw new Error(`${block}: a row is missing its ${key}`);
  }
  return value;
}

function stringField(row: Record<string, unknown>, key: string, block: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`${block}: a row's ${key} is not a string`);
  return value;
}

function numberField(row: Record<string, unknown>, key: string, block: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${block}: a row's ${key} is not a number`);
  }
  return value;
}

/**
 * Parse the volumes script's stdout.
 * @param stdout - the script's stdout (post {@link shellStdout}).
 * @returns the volume rows.
 */
export function parseVolumeRows(stdout: string): readonly LocalVolumeRow[] {
  return parseRowArray(stdout, "volumes").map((row) => ({
    name: requiredString(row, "name", "volumes"),
    fileSystem: stringField(row, "fileSystem", "volumes"),
    sizeBytes: numberField(row, "sizeBytes", "volumes"),
    freeBytes: numberField(row, "freeBytes", "volumes"),
  }));
}

/**
 * Parse the accounts script's stdout.
 * @param stdout - the script's stdout (post {@link shellStdout}).
 * @returns the account rows.
 */
export function parseAccountRows(stdout: string): readonly LocalAccountRow[] {
  return parseRowArray(stdout, "accounts").map((row) => {
    const enabled = row["enabled"];
    if (typeof enabled !== "boolean") throw new Error("accounts: a row's enabled is not a boolean");
    const groups = row["groups"];
    if (!Array.isArray(groups) || groups.some((g) => typeof g !== "string")) {
      throw new Error("accounts: a row's groups is not a string array");
    }
    return {
      name: requiredString(row, "name", "accounts"),
      kind: requiredString(row, "kind", "accounts"),
      enabled,
      groups: groups as string[],
    };
  });
}

/**
 * Parse the patches script's stdout.
 * @param stdout - the script's stdout (post {@link shellStdout}).
 * @returns the hotfix rows, most recent first (the script sorts).
 */
export function parsePatchRows(stdout: string): readonly LocalPatchRow[] {
  return parseRowArray(stdout, "patches").map((row) => ({
    id: requiredString(row, "id", "patches"),
    installedOn: stringField(row, "installedOn", "patches"),
  }));
}

/**
 * Parse the software script's stdout. The same program can appear under
 * several uninstall keys (both hives, the WOW6432Node view); identical
 * name+version+publisher rows are one program and are counted once.
 * @param stdout - the script's stdout (post {@link shellStdout}).
 * @returns the software rows, de-duplicated.
 */
export function parseSoftwareRows(stdout: string): readonly LocalSoftwareRow[] {
  const seen = new Set<string>();
  const rows: LocalSoftwareRow[] = [];
  for (const row of parseRowArray(stdout, "software")) {
    const name = requiredString(row, "name", "software");
    const version = stringField(row, "version", "software");
    const publisherRaw = row["publisher"];
    if (publisherRaw !== undefined && typeof publisherRaw !== "string") {
      throw new Error("software: a row's publisher is not a string");
    }
    const publisher = publisherRaw === undefined || publisherRaw === "" ? undefined : publisherRaw;
    const key = `${name}\0${version}\0${publisher ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ name, version, ...(publisher !== undefined ? { publisher } : {}) });
  }
  return rows;
}

/**
 * The artifact's patch-level summary for a COLLECTED patch block.
 * @param rows - the collected hotfix rows, most recent first.
 * @returns the one-line summary.
 */
export function patchLevelSummary(rows: readonly LocalPatchRow[]): string {
  if (rows.length === 0) return "Patch level collected: Get-HotFix reported no installed hotfixes.";
  const latest = rows[0]!;
  const when = latest.installedOn !== "" ? ` on ${latest.installedOn}` : "";
  return `Patch level: ${String(rows.length)} hotfix${rows.length === 1 ? "" : "es"} installed; most recent ${latest.id}${when}.`;
}
