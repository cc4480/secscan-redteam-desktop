import { TIER_DEFINITION, TIER_LABEL, TIER_ORDER } from "./html/tokens.js";
import { activityMd, detailMd, inventoryMd } from "./markdown-sections.js";
const sevLine = (doc) => {
    const sc = doc.severityCounts;
    return `${sc.critical} critical · ${sc.high} high · ${sc.medium} medium · ${sc.low} low · ${sc.info} info`;
};
const tierLine = (doc) => {
    const tc = doc.tierCounts;
    return `${tc.proven} proven · ${tc.confirmed} confirmed · ${tc.deferred} deferred · ${tc["ruled-out"]} ruled out`;
};
function gradeLine(doc) {
    if (doc.haltedReason)
        return `**Grade N/A** — engagement halted: ${doc.haltedReason}`;
    if (doc.blockedReason)
        return `**Grade N/A** — engagement blocked: ${doc.blockedReason}`;
    return `**Grade ${doc.posture.grade} — ${doc.posture.score}/100** (${doc.posture.postureRating})`;
}
function coverMd(doc) {
    const m = doc.meta;
    const lines = [
        `# ${doc.title} — ${m.target}`,
        "",
        `- Engagement: ${m.engagementId}`,
        `- Mode: ${m.mode} · tier ${m.tier} · ${m.environment}`,
        `- Status: ${m.status}${doc.dryRun ? " (dry run)" : ""}`,
        `- Authorisation: ${m.verified ? "ownership verified" : "not verified"}`,
    ];
    if (m.operator)
        lines.push(`- Operator: ${m.operator}`);
    if (m.client)
        lines.push(`- Client: ${m.client}`);
    lines.push(`- Started: ${m.startedAt}`, `- Generated: ${m.generatedAt}`);
    if (m.objective)
        lines.push(`- Objective: ${m.objective}`);
    lines.push("", gradeLine(doc), "", `Severity: ${sevLine(doc)}`, `Tiers: ${tierLine(doc)}`);
    if (doc.banner && !doc.haltedReason && !doc.blockedReason) {
        lines.push("", `**${doc.banner.title}** — ${doc.banner.message}`);
    }
    return lines.join("\n");
}
function coverageMd(doc, annexes) {
    const c = doc.coverage;
    const t = c.totals;
    const parts = [
        "## Coverage",
        "",
        `${c.fullBattery ? "Full battery" : "Scoped run"} — every cell states what actually ran; nothing below is inferred.`,
        "",
        "| Target | Category | State |",
        "|---|---|---|",
        ...c.cells.map((cell) => `| ${cell.target} | ${cell.category} | ${cell.state} |`),
    ];
    if (t.total > 0) {
        parts.push("", `${t.total} battery items: ${t.confirmed} confirmed · ${t.executedClean} executed-clean · ${t.killed} killed · ${t.blocked} blocked · ${t.na} not-applicable · ${t.pending} pending${c.probesUsed > 0 ? ` · ${c.probesUsed} probes` : ""}`);
    }
    else if (c.probesUsed > 0) {
        parts.push("", `${c.probesUsed} probes used`);
    }
    const limits = [];
    for (const cell of c.cells)
        if (cell.state === "blocked")
            limits.push(`Blocked (prerequisite not met): ${cell.target}:${cell.category}`);
    for (const p of c.planOnly)
        limits.push(`Executes when its prerequisite is supplied: ${p}`);
    for (const n of c.notCovered)
        limits.push(`Not covered: ${n}`);
    if (limits.length)
        parts.push("", "### Honest limits", "", ...limits.map((l) => `- ${l}`));
    parts.push("", annexes.batteryLine);
    if (annexes.nucleiLine)
        parts.push("", annexes.nucleiLine);
    return parts.join("\n");
}
function findingMd(doc, f) {
    const meta = doc.findingMeta.get(f.id);
    const head = [`- Severity: ${f.severity} · Status: ${f.status}`];
    if (typeof meta?.cvss === "number")
        head.push(`CVSS: ${meta.cvss.toFixed(1)}`);
    if (meta?.cwe)
        head.push(`CWE: ${meta.cwe}`);
    if (meta?.category)
        head.push(`Category: ${meta.category}`);
    if (meta?.owasp)
        head.push(`OWASP: ${meta.owasp}`);
    if (f.attackIds.length > 0)
        head.push(`ATT&CK: ${f.attackIds.join(", ")}`);
    const parts = [`#### ${f.id} — ${f.title}`, "", head.join(" · ")];
    const bundle = doc.bundles.get(f.id);
    const noBundle = doc.noBundleReasons.get(f.id);
    if (bundle) {
        parts.push("", `**Proof:** ${bundle.validationTier === "execution" ? "execution-tier bundle" : "observation bundle"} — ${bundle.proves}`, `Reverify: ${bundle.reverifyCommand}`);
    }
    else if (noBundle) {
        parts.push("", `**Proof:** no replayable bundle — ${noBundle}`);
    }
    if (f.evidence)
        parts.push("", "**Evidence**", "", f.evidence);
    const impact = doc.detail?.findingImpacts[f.id];
    if (impact)
        parts.push("", "**Impact**", "", impact);
    if (f.fix)
        parts.push("", "**Remediation**", "", f.fix);
    if (f.retest)
        parts.push("", `**Retest:** ${f.retest}`);
    if (f.accountableOperator)
        parts.push("", `Accountable: ${f.accountableOperator}`);
    return parts.join("\n");
}
function findingsMd(doc) {
    const parts = ["## Findings"];
    const tc = doc.tierCounts;
    if (tc.proven + tc.confirmed + tc.deferred === 0 && !doc.haltedReason && !doc.blockedReason) {
        parts.push("", "### Zero Vulnerabilities Outstanding", "", "No confirmed findings this engagement. The coverage record above states what was actually checked.");
    }
    for (const g of doc.tierGroups) {
        parts.push("", `### ${TIER_LABEL[g.tier]} — ${g.findings.length + g.negativeProof.length}`, "", `_${TIER_DEFINITION[g.tier]}_`);
        for (const f of g.findings)
            parts.push("", findingMd(doc, f));
        for (const n of g.negativeProof) {
            parts.push("", `#### ${n.hypothesis} (ruled out)`, "", `**Decisive observation:** ${n.killingObservation}`);
        }
    }
    return parts.join("\n");
}
/** Render report.md from the document, in the canonical anatomy. */
export function renderReportMarkdown(doc, annexes) {
    const parts = [coverMd(doc)];
    const narrative = doc.narrativeMd.trim();
    const detail = detailMd(doc);
    if (narrative || detail) {
        parts.push(`## Executive Summary${narrative ? `\n\n${narrative}` : ""}${detail ? `\n\n${detail}` : ""}`);
    }
    parts.push(coverageMd(doc, annexes));
    if (annexes.itemsMd && annexes.itemsMd.trim())
        parts.push(annexes.itemsMd.trim());
    parts.push(`## Severity Breakdown\n\nSeverity: ${sevLine(doc)}\n\nTiers: ${tierLine(doc)}`);
    parts.push(findingsMd(doc));
    if (annexes.proofMd.trim())
        parts.push(annexes.proofMd.trim());
    if (doc.fixPrompt) {
        parts.push(`## Complete Fix Prompt\n\nOne consolidated, paste-ready prompt covering every actionable finding, composed from the records above.\n\n\`\`\`\n${doc.fixPrompt}\n\`\`\``);
    }
    const d = doc.detail;
    if (d && (d.priority.zeroNote || d.priority.actions.length > 0 || d.priority.verifyNext.length > 0)) {
        const lines = ["## Priority Actions", ""];
        if (d.priority.zeroNote) {
            lines.push(`1. **No action required** — ${d.priority.zeroNote}`);
        }
        else {
            d.priority.actions.forEach((e, i) => lines.push(`${i + 1}. **Fix ${e.id} — ${e.title}.** ${e.fixSentence}`));
            if (d.priority.verifyNext.length > 0) {
                lines.push("", "### Verify next", "");
                d.priority.verifyNext.forEach((e, i) => lines.push(`${i + 1}. **Verify ${e.id} — ${e.title}.** ${e.fixSentence}`));
            }
        }
        parts.push(lines.join("\n"));
    }
    if (d && d.pillars.length > 0) {
        const rows = d.pillars.map((p) => `| ${p.pillar} | ${p.scopeLabel} | ${p.status}${p.status === "FINDINGS" ? ` ${p.findingCount}` : ""}${p.reason ? ` — ${p.reason}` : ""}${p.footnote ? ` (${p.footnote})` : ""} |`);
        parts.push(`## Pillar Coverage\n\n| Pillar | Scope | Status |\n|---|---|---|\n${rows.join("\n")}`);
    }
    if (doc.matter?.strengths) {
        const s = doc.matter.strengths;
        parts.push(`## What Is Working Well\n\n${s.summary}${s.areaLines.length ? `\n\n${s.areaLines.map((l) => `- ${l}`).join("\n")}` : ""}`);
    }
    if (d && ((d.surfaceNetwork && d.surfaceNetwork.length > 0) || d.surfaceDynamic.length > 0)) {
        const wells = ["## Surface & Coverage Detail"];
        if (d.surfaceNetwork && d.surfaceNetwork.length > 0) {
            wells.push("", "### Network & Attack Surface", "", ...d.surfaceNetwork.map((r) => `- ${r.label}: ${r.value}`));
        }
        if (d.surfaceDynamic.length > 0) {
            wells.push("", "### Dynamic Coverage", "", ...d.surfaceDynamic.map((r) => `- ${r.label}: ${r.value}`));
        }
        parts.push(wells.join("\n"));
    }
    if (doc.inventory !== undefined)
        parts.push(inventoryMd(doc));
    const activity = activityMd(doc);
    if (activity)
        parts.push(activity);
    if (doc.matter) {
        const m = doc.matter;
        const rows = [...m.scopeRows, ...m.authorisationRows].map((r) => `- ${r.label}: ${r.value}`);
        parts.push(`## Scope & Authorisation\n\nThe rules of engagement and the authorisation record, exactly as recorded — nothing here is inferred.\n\n${rows.join("\n")}`);
        parts.push(`## Method & Tooling\n\n${m.methodLines.join("\n\n")}`);
        const tiers = TIER_ORDER.map((t) => `- **${TIER_LABEL[t]}:** ${TIER_DEFINITION[t]}`).join("\n");
        parts.push(`## Risk Rating Method\n\n${m.riskMethodLines.join("\n\n")}\n\n${tiers}`);
        parts.push(`## Limitations & Residual Unknowns\n\n${m.limitationLines.map((l) => `- ${l}`).join("\n")}`);
    }
    if (annexes.integrationsMd.trim())
        parts.push(annexes.integrationsMd.trim());
    parts.push(`---\n\nArtifacts: report.md · item-verdicts.json · poc/*.json · compliance-pack.html · attestation.html · safety-manifest.html · state.json · events.jsonl.\n\nGenerated ${doc.meta.generatedAt} by SecScan RedTeam from the engagement audit log. The machine-readable records are the authoritative source for every figure above — verify findings against them before acting.`);
    return parts.join("\n\n") + "\n";
}
//# sourceMappingURL=markdown.js.map