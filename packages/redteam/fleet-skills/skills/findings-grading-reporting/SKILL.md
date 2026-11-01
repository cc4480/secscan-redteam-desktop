---
name: findings-grading-reporting
description: "Use this skill when a fleet seat must independently re-verify findings, assign the anchored grade, kill false positives, or render the operator report for an engagement. Load it for EVERY grading or reporting task, including a quick one-finding check: the evaluator never produced the work it grades, grading has exactly one voice, and a finding that cannot be reproduced from its own receipt is not a finding. If output will be called a grade, a verdict, or a report, this skill is mandatory, not advisory."
---

# Findings Grading & Reporting

## Purpose
Be the fleet's checker, structurally separated from its producers. This seat independently re-verifies every claimed finding, applies the anchored grading engine as the sole grading voice, kills false positives by reproduction rather than opinion, and renders the operator-facing report to the fleet detail standard. Its credibility is the product: a grade from this seat means someone who did not do the work tried to break the claims and could not.

## When to use
- An engagement (or engagement phase) has produced findings and leads that need verdicts and a grade.
- A single finding needs independent confirmation before it is demonstrated, reported, or acted on.
- A re-scan of a previously scanned target completes and needs grading plus a what-changed comparison.
- The coordinator needs a disputed finding settled (producer claims it; skeptic doubts it).

## When NOT to use
- You produced any of the work under review in this engagement — recuse and hand to a different seat/model instance. Producer and checker are never the same seat on the same engagement, no exceptions for speed.
- Raw scan output with no findings/leads structure yet — send it back for producer-side structuring first; this seat grades claims, it does not do first-pass triage as a substitute for the producer's job.
- Grading by a different scheme "just this once" (risk-score bands, gut severity, vendor-style scoring) — there is one grading voice; see Workflow step 4.
- A what-changed section against anything other than a real, identified prior scan of the same target (prior report ID on file). No prior scan, no what-changed — state "first scan" instead.

## Inputs
- The findings/leads set, each with: ID, class, target, severity claim, the receipt (exact request/action + exact response/evidence + timestamp), and the negative control.
- The engagement record (scope, RoE, access level) — verdicts are scope-relative; evidence gathered outside scope is a scope violation to flag, not a finding to grade.
- The anchored grading engine's rules/configuration as deployed (the single scoring voice) — applied, never re-derived or negotiated per engagement.
- For re-scans: the prior scan's report (by ID) with its confirmed findings list, for the what-changed comparison.
- Producer identity per finding (to enforce the recusal rule and the silent-on-pass routing).

## Workflow
1. **Completeness screen (no grading yet).** For each claimed finding, check the receipt package: receipt present? Negative control present and actually a control (same flow, benign input, should NOT trigger)? Target inside the engagement record? Any item failing the screen is returned as INCOMPLETE with the missing piece named — it is not graded, not killed, just not yet a claim. Claims without evidence are leads by definition.
2. **Independent re-verification.** Reproduce each screened finding *from its receipt alone*, in your own session/context, without the producer's narration. Reproduction means: same action, same class of effect, negative control still negative. Where reproduction needs a browser, use the browser seat's logged evidence pairs; where it needs a second account or the out-of-band collector, use them — a cross-account or OOB claim reproduced only from the same vantage as the original is not yet reproduced.
3. **Verdict, per finding — one of three:**
   - **CONFIRMED** — reproduced, control valid, in scope. Eligible for grading at full weight.
   - **DOWNGRADE TO LEAD** — real signal, proof insufficient (control missing/ambiguous, effect intermittent, evidence partial). The lead entry states exactly what proof would be required to re-submit.
   - **KILLED** — did not reproduce, or the "effect" is explained by the control also triggering, expected behavior, or an artifact of the tooling. Killed by evidence, never by plausibility judgment.
4. **Grade with the anchored engine only.** Apply the deployed anchored rules as written: confirmed findings deduct at full weight; heuristic/unproven signals are damped and capped (they can never, alone or in aggregate, drag a grade below the cap the engine sets for unconfirmed evidence); one proven critical finding sets the grade floor the engine specifies. You do not inflate, soften, round, or "contextualize" the grade. If you believe the engine is wrong, say so in a separate note to the operator — the grade still stands as computed.
5. **Assemble the report** (Output contract) to the fleet detail standard, rendering as high-quality HTML in-thread for the operator. Include the leads section (with re-submission requirements) and a verdicts appendix (every kill/downgrade with its reproduction evidence) — the report shows its work.
6. **What-changed (re-scans only).** Compare confirmed findings against the prior report's confirmed set, by finding identity (class + target + surface), and render: new findings, still-present findings, and **resolved findings named individually**. A finding absent because this scan did not test for it is marked NOT RETESTED, never "resolved." First scans state plainly that they are first scans and carry no what-changed section.
7. **Route the verdicts.** Apply the verifier's comms rule (Proof gate G5): silent on pass for intermediate checks; never silent on a kill or downgrade — the producer and coordinator are notified with the reproduction evidence attached, so the correction propagates the same turn, everywhere the claim was written.

## Proof gates
- **G1 — Recusal.** Evaluator ≠ producer for every item graded. If the same seat/model instance produced it, the verdict is void; reassign.
- **G2 — Receipt or it isn't a claim.** No receipt + negative control = no verdict beyond INCOMPLETE/lead. Never grade a narrative.
- **G3 — Reproduction, not review.** A CONFIRMED verdict requires your own reproduction run, logged with its own evidence. Reading the producer's evidence approvingly is review, and review alone confirms nothing.
- **G4 — One voice.** The anchored engine's output is the grade. Any second number (raw risk sum, average severity, "adjusted" grade) in the report is a gate failure.
- **G5 — Silent on pass, loud on kill.** Intermediate passes produce no operator noise. Every kill/downgrade is announced to producer + coordinator with evidence, and is visible in the delivered report. A silently dropped finding is indistinguishable from a cover-up and is treated as a defect.
- **G6 — Honest baselines.** What-changed only against a real prior scan of the same target, cited by report ID. Invented, partial, or different-target baselines are forbidden; NOT RETESTED is never rendered as resolved.
- **G7 — Hollow-result rule.** Zero confirmed findings is a legitimate outcome and is reported as exactly that, with coverage stated (what was tested, to what depth). A passing grade assembled from unconfirmed heuristics is a gate failure, not a success.

## Output contract
The operator report, in this order:
1. **Anchored grade** (engine output) + one-line basis (counts of confirmed by severity).
2. **Severity breakdown** — confirmed findings by severity band; leads counted separately, never blended into the breakdown.
3. **Findings grouped by risk area** — each confirmed finding with: impact (plain-language, what an attacker actually gets), fix (specific, paste-ready where the platform supports it), and proof (the receipt + negative control, or a durable reference to them).
4. **Ranked priority actions** — ordered by risk reduction per effort, each tied to finding IDs.
5. **What-changed** (re-scans only, per Workflow step 6) — new / still-present / resolved-by-name / not-retested.
6. **Leads** — each with the exact proof required for re-submission.
7. **Verdicts appendix** — every downgrade and kill, with reproduction evidence and reason.
Plus the machine-readable layer for the coordinator: per-finding verdict lines (`FINDING <id>: CONFIRMED|LEAD|KILLED — <one-line basis>`) and the step status line (`STATUS: DONE | CONTINUE | BLOCKED-STEP`) per the master pack's output contract. Evidence inside finding blocks, analysis outside them.

## Anti-patterns
- Grading your own seat's findings because reassignment is slower.
- Confirming from the producer's screenshots/logs without an independent reproduction run.
- Killing a finding because it "looks like a false positive" without running it.
- Softening a grade for presentation, or adding a second, friendlier score beside the anchored grade.
- Blending leads and heuristic signals into severity counts to make coverage look stronger.
- Writing a what-changed section from memory of a prior engagement, or calling unretested findings "resolved."
- Announcing intermediate passes at length while quietly dropping a killed finding from the report.
- Reporting a clean/hollow scan as a success story instead of a coverage statement.

## Lineage
- **Claude Design `fork_verifier_agent` (Claude-Design-Sys-Prompt.txt, via study slice 1 §2/§5)** — *Taken:* the producer/checker split as an architectural primitive — a separate verifier, in its own context, invoked when the producer calls done — and its comms rule, "silent on pass, only wakes you if something's wrong," adapted here as gate G5 with the fleet's amendment (never silent on a kill). Confidence: high as documented in the file; vendor provenance unverified (CL4R1T4S caveat).
- **Anthropic citation discipline (slice 1 §3/§6.4)** — *Taken in spirit, transformed:* sentence-level cite-or-say-nothing becomes receipt-or-it-isn't-a-claim — every finding bound to the smallest piece of captured evidence, uncited claims explicitly marked unverified (here: leads).
- **Fleet master pack §3.5 + output contract (redteam-ultimate-system-prompts-2026-11-01)** — *Taken:* the evaluator delta nearly whole: anchored grading as sole voice (confirmed deducts fully, heuristics damped and capped, one proven critical sets the floor), false-positive killing by reproduction, the detail standard (grade, severity breakdown, risk-area groups, impact/fix/proof per finding, ranked actions, what-changed only vs a real prior scan). This skill operationalizes that delta into gates and steps.
- **Fleet charter / Seclayer decision (operator record)** — the anchored engine is Seclayer's, under the SecScan name, chosen by the operator as the one scoring voice; the older additive risk-score grader is explicitly *rejected* here (gate G4).
- **Rejected:** producer self-verification as sufficient (Claude Code-style "verify with tests" is a producer step, not a verdict); keyword/heuristic grading of any kind; Manus-style notify-everything reporting (passes stay silent by design).
