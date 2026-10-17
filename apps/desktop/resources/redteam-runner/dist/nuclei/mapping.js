/** Template-id/tag hints → battery item ids. Conservative: only map when the tag is unambiguous. */
const TAG_TO_ITEMS = [
    // Exposed panels / default credentials overlap host auth-surface items.
    { tag: "default-login", items: ["WS-019", "LX-018"] },
    { tag: "misconfig", items: ["WS-043", "LX-041"] },
    { tag: "exposure", items: ["WS-038", "LX-041"] },
    // NOTE: no blanket "cve" tag mapping. A CVE-named template whose CVE was
    // already validated (via msf or a battery item) overlaps via the
    // knownCves path below. A CVE template for an UNconfirmed CVE is new
    // information — it becomes a template-only runtime instance under
    // WS-108/LX-110, never forced into the Metasploit methodology items.
];
/** Methodology items that own template-only runtime instances. */
export const NUCLEI_METHODOLOGY_ITEMS = { windows: "WS-108", linux: "LX-110" };
/**
 * Map a Nuclei finding to overlapping battery items. CVE match is the
 * strongest signal; tag hints are secondary. Unknown → templateOnly.
 */
export function mapTemplateToBattery(finding, targetProfile, knownCves = new Set()) {
    const items = new Set();
    if (finding.cve && knownCves.has(finding.cve)) {
        // The CVE was already confirmed by a battery/msf finding — same finding,
        // second evidence source. The methodology items own the mapping entry.
        items.add(targetProfile === "windows" ? "WS-106" : "LX-108");
    }
    const hay = `${finding.templateId} ${finding.tags.join(" ")}`.toLowerCase();
    for (const { tag, items: mapped } of TAG_TO_ITEMS) {
        if (hay.includes(tag)) {
            for (const id of mapped) {
                if ((targetProfile === "windows") === id.startsWith("WS"))
                    items.add(id);
            }
        }
    }
    const batteryItems = [...items];
    const templateOnly = batteryItems.length === 0;
    return {
        batteryItems,
        templateOnly,
        methodologyItem: templateOnly ? NUCLEI_METHODOLOGY_ITEMS[targetProfile] : undefined,
    };
}
/** One-line overlap hint for the agent result string. */
export function overlapHint(overlap) {
    if (overlap.templateOnly) {
        return `No battery overlap — record as a runtime instance under ${overlap.methodologyItem} (template-only finding).`;
    }
    return `Overlaps battery item(s) ${overlap.batteryItems.join(", ")} — record ONE finding with both evidence sources, never two findings.`;
}
//# sourceMappingURL=mapping.js.map