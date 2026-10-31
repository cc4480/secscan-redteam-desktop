/**
 * Local host mode — collected inventory contract.
 *
 * A local engagement assesses the machine the runner itself runs on. The
 * collector (collect.ts) gathers host inventory through the paired pc-agent
 * channel on that same machine — never through SMB/WinRM/SSH and never with
 * target credentials — and returns this record. Collection runs in two
 * tiers over that one channel: tier-0 read-only bridge ops first (identity
 * gate, processes, directory listings), then — only after the identity
 * gate passes — tier-2 fixed read-only PowerShell scripts (scripts.ts)
 * for the blocks no tier-0 op enumerates: volumes, accounts, patches,
 * software. The report's host-inventory section renders `sections` in
 * declaration order; a section the collection cannot fill is `failed` or
 * `unsupported` with the reason in `note`, never an empty table presented
 * as collected data.
 */

/** Outcome of one inventory section. */
export type LocalInventorySectionStatus = "collected" | "failed" | "unsupported";

/** One inventory section of a local collection. */
export interface LocalInventorySection<T = unknown> {
  readonly status: LocalInventorySectionStatus;
  /** Parsed data, when the bridge returned JSON or the section is structured. */
  readonly data?: T;
  /** The bridge's result text, verbatim (truncated per the collector's cap). */
  readonly raw?: string;
  /** True when `raw` was truncated to the collector's cap. */
  readonly truncated?: boolean;
  /** Failure text when failed; the named reason when unsupported. */
  readonly note?: string;
  /**
   * How much of the host battery's inventory-class need this section answers.
   * Local sections answer part of it at best (identity and process context,
   * not wire probes) — "partial" is the ceiling, by design.
   */
  readonly batteryCoverage: "partial" | "none";
}

/** The fields of a bridge `system_info` result the collector relies on. */
export interface LocalSystemInfo {
  readonly system?: string;
  readonly release?: string;
  readonly version?: string;
  readonly machine?: string;
  readonly hostname?: string;
  readonly user?: string;
  readonly cpuPercent?: number;
  readonly memPercent?: number;
}

/** One directory listing inside the filesystem section. */
export interface LocalDirListing {
  readonly path: string;
  readonly raw: string;
}

/** One mounted volume (tier-2 Get-Volume row). */
export interface LocalVolumeRow {
  readonly name: string;
  /** File-system name ("NTFS"); "" when the volume reports none. */
  readonly fileSystem: string;
  readonly sizeBytes: number;
  readonly freeBytes: number;
}

/** One local account (tier-2 Get-LocalUser row, groups resolved by SID). */
export interface LocalAccountRow {
  readonly name: string;
  /** Account class; the fixed script emits "local user". */
  readonly kind: string;
  readonly enabled: boolean;
  /** Names of the local groups the account belongs to. */
  readonly groups: readonly string[];
}

/** One installed hotfix (tier-2 Get-HotFix row, most recent first). */
export interface LocalPatchRow {
  /** Hotfix id ("KB5066133"). */
  readonly id: string;
  /** Install date as the script formatted it ("2026-10-12"); "" when unknown. */
  readonly installedOn: string;
}

/** One installed program (tier-2 registry uninstall-keys row). */
export interface LocalSoftwareRow {
  readonly name: string;
  /** Display version; "" when the uninstall entry carries none. */
  readonly version: string;
  /** Publisher; the script omits the field when the entry carries none. */
  readonly publisher?: string;
}

/** Verification basis recorded on every local engagement. */
export type LocalVerificationBasis = "local-operator-possession";

/** A complete local inventory collection. */
export interface LocalHostInventory {
  readonly version: 1;
  readonly mode: "local";
  /** ISO timestamp of the collection. */
  readonly collectedAt: string;
  /** The channel the inventory came through; the URL only, never the token. */
  readonly channel: { readonly kind: "pc-agent"; readonly url: string };
  readonly target: {
    /** The hostname the engagement declared as its local target. */
    readonly declaredHostname: string;
    /** The hostname the machine reported about itself; null when unreadable. */
    readonly collectedHostname: string | null;
    /** True only when the collected hostname matches the declared target. */
    readonly hostnameMatch: boolean;
  };
  readonly verification: {
    readonly basis: LocalVerificationBasis;
    /** Human-readable basis text; recorded on the engagement record. */
    readonly proof: string;
    readonly scopeHosts: readonly string[];
  };
  readonly sections: {
    readonly system: LocalInventorySection<LocalSystemInfo>;
    readonly processes: LocalInventorySection;
    readonly filesystem: LocalInventorySection<readonly LocalDirListing[]>;
    readonly volumes: LocalInventorySection<readonly LocalVolumeRow[]>;
    readonly users: LocalInventorySection<readonly LocalAccountRow[]>;
    readonly installedSoftware: LocalInventorySection<readonly LocalSoftwareRow[]>;
    readonly services: LocalInventorySection;
    readonly listeningPorts: LocalInventorySection;
    readonly patches: LocalInventorySection<readonly LocalPatchRow[]>;
  };
}
