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
export {};
//# sourceMappingURL=types.js.map