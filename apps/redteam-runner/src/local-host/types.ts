/**
 * Local host mode — collected inventory contract.
 *
 * A local engagement assesses the machine the runner itself runs on. The
 * collector (collect.ts) gathers host inventory through the paired pc-agent
 * channel on that same machine — never through SMB/WinRM/SSH and never with
 * target credentials — and returns this record. The report's host-inventory
 * section renders `sections` in declaration order; a section the channel
 * cannot answer is `unsupported` with the reason in `note`, never an empty
 * table presented as collected data.
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
    readonly users: LocalInventorySection;
    readonly installedSoftware: LocalInventorySection;
    readonly services: LocalInventorySection;
    readonly listeningPorts: LocalInventorySection;
    readonly patches: LocalInventorySection;
  };
}
