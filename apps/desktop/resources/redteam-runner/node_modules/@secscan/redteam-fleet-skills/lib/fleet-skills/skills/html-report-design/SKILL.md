---
name: html-report-design
description: "Use this skill when a fleet seat renders, restyles, or reviews an HTML engagement report — the presenting artifact the client sees. Load it for EVERY HTML report render, including a re-render of graded findings you did not grade: the design is locked, the anatomy is frozen, and an improvised layout is a defect even when the findings are right. Grading and verdicts belong to findings-grading-reporting; this skill governs only how the finished report looks and is built. If the output is an HTML page a human will read, this skill is mandatory, not advisory."
---

# HTML Report Design

## Purpose
Make every HTML report the fleet ships read as high-end professional work: dark glass on zinc-black, quiet depth, spacing that breathes, motion that explains instead of decorating. The report is the product's face — the MD/JSON/TXT/CSV artifacts are data; the HTML is what gets shown. If a screenshot of the page would not hold up next to a Linear/Vercel/Stripe-grade surface, it is not done.

This skill carries the operator's locked design authority (locked 2026-10-29) into the fleet. It invents nothing: if a design choice is not covered here, keep the frozen anatomy and the token values — do not improvise a new look.

## When to use
- Rendering the engagement report as HTML (in-thread or as the report.html artifact).
- Restyling or repairing any report-like HTML page for the operator's products.
- Reviewing an HTML report before delivery — run the acceptance checklist as a self-check.

## When NOT to use
- Grading findings, assigning verdicts, or computing the grade — that is findings-grading-reporting, the one grading voice. This skill presents its output; it never re-derives a grade.
- The data artifacts (report.md/.json/.txt, findings.csv, report.docx, the package zip) — they carry the same facts without this design layer.
- Chat-shell chrome (navigation, composer, side panels) — the shell shares this glass language and token set, but its layout is a separate surface; do not restyle the report's internals to match shell furniture or vice versa.
- Filling a section the data does not support. An empty section is rendered honestly (zero-state, "not covered", "first scan") — never padded with invented content to make the design look complete.

## Inputs
- The graded findings set with verdicts and tiers (PROVEN / CONFIRMED / DEFERRED / RULED OUT), each finding's receipt/evidence and fix, from the evaluator seat.
- The anchored grade and score from the grading engine — the only grade that may appear.
- Coverage data: what was probed, what was blocked, gated, deferred, or not covered.
- The report token values (severity and grade hexes, below) — the single source of truth for color.

## Non-negotiables (breaking any of these fails the build)
1. **Single self-contained file.** All CSS inline in the document; zero external requests (no fonts, images, scripts, or stylesheets fetched). URLs may appear only as evidence text.
2. **Rendering never requires JS.** Content is fully present in the static document. JS, if present at all, is progressive enhancement only (e.g. a copy button).
3. **Print is a first-class surface.** The print stylesheet shows the FINAL state of everything — animations settled, all sections visible, no glass transparency that washes out on paper.
4. **Content contract is frozen.** Anatomy: cover → posture banner (anchored grade + 270° gauge) → executive summary → coverage strip (with honest limits) → findings grouped PROVEN → CONFIRMED → DEFERRED → RULED OUT → consolidated fix prompt → audit footer. Grades come from the anchored grading engine only.
5. **Tokens are the single source of truth.** Colors, severity hexes, and grade accents come from the token table — never hard-code a hex in a component that the table defines.

## Design language — glass on zinc-black
- **Base:** zinc-black background (#0a0a0b family) with a very subtle radial light falloff from the top; never flat pure black, never a colored wash.
- **Glass panels:** translucent white fills (rgba white 3–6%), `backdrop-filter: blur(14px) saturate(140%)`, 1px hairline border (rgba white 8–12%), and a top inner highlight (inset box-shadow, white at 4–6%) so the panel edge catches light. Border-radius 14–18px on major panels, 10–12px on cards.
- **Depth:** at most two shadow layers, both soft and dark (large blur, low alpha). No colored glows except the grade accent used sparingly on the gauge.
- **Severity & grade colors:** exactly the token values below. Color is information, never decoration — a red element means critical, everywhere, and severity is never carried by color alone: the text label always rides with it.

### Token table (from the report token module — copy these, invent none)
| Role | Screen hex | Print hex |
| --- | --- | --- |
| Critical | #f87171 | #dc2626 |
| High | #fb7185 | #e11d48 |
| Medium | #fbbf24 | #ca8a04 |
| Low | #60a5fa | #2563eb |
| Info | #a1a1aa | #52525b |
| Secure / pass | #22c55e | #059669 |
| Grade A — Excellent | #22c55e | #059669 |
| Grade B — Good | #84cc16 | #16a34a |
| Grade C — Fair | #fbbf24 | #ca8a04 |
| Grade D — Poor | #fb923c | #ea580c |
| Grade F — Critical | #ef4444 | #dc2626 |
| Grade N/A — Incomplete | #94a3b8 | #64748b |

## Typography
- System font stack only (no webfonts — non-negotiable 1). Data, IDs, hashes, and code in the ui-monospace stack.
- Scale: cover title 28–32px; section heads 15–17px semibold with letter-spacing; body 13–14px. Nothing between steps, nothing outside the scale.
- Numbers in the gauge and score are tabular.

## Spacing rhythm
- One spacing scale: **4 / 8 / 12 / 16 / 24 / 32**. Every padding, margin, and gap is one of these values — no 10px, 13px, 20px, or 26px improvisations.
- Section gaps are larger than card gaps. Nothing touches a panel edge: content always sits at least one scale step inside its container.

## Motion system — animate the meaning
Motion explains the data; it never delays reading. All animation is CSS; total entrance choreography finishes within ~1.2s.
- **Gauge:** the 270° arc sweeps from zero to the score over ~900ms with an ease-out curve; the score number counts up in step. The resting state is the true score — animation is presentation, the printed/final state is authoritative.
- **Severity bar:** segments grow to their true widths left-to-right, ~600ms, slight stagger per segment.
- **Finding cards:** staggered entrance (fade + 8px rise), ~40ms apart, in reading order. PROVEN cards may carry one subtle accent pulse on the badge — once, never looping.
- **Expansion:** proof/evidence blocks open with a smooth height-and-fade (~220ms); code and receipts never reflow-jump.
- **Hover (screen only):** cards lift 1px with a softened shadow deepening; links and buttons transition color/opacity in 120–150ms.
- **Easing:** one house curve (cubic-bezier(0.22, 1, 0.36, 1)) for entrances; ease-out for meters. No bounces, no elastic, nothing loops.
- **Reduced motion:** under `prefers-reduced-motion`, ALL animation is off and every element sits in its final state.
- **Print:** animations are disabled in print CSS; final states only (gauge at score, bars at width, cards visible).

## Component rules
- **Gauge:** SVG 270° arc on a glass disc; grade letter large beside it; anchored ceiling effects (e.g. a proven critical capping the grade) must be visually obvious, not a footnote.
- **Finding card:** glass card; severity chip (token color + text label), title, impact line, evidence receipt block (verbatim quote + replay command in mono, in a recessed well), fix block. The tier badge (PROVEN / CONFIRMED / DEFERRED / RULED OUT) is part of the card header, never color alone — text label always.
- **Coverage strip:** honest by construction — shows what was tested AND what was not (gated, deferred, out of scope) with the same visual weight; a gap never renders as a pass.
- **Fix prompt:** one consolidated, copy-ready block in a recessed mono well, built mechanically from actionable confirmed findings only.
- **Footer:** audit facts (engagement id, target, verification, timestamps) in quiet mono type.

## Honesty rules (they bind the design, not just the data)
- A PROVEN card exists only with an execution-tier proof bundle behind the finding. An observation-tier receipt is a receipt, never a PROVEN badge.
- Never fabricate proof, coverage, or findings to fill the design. A section with nothing true to show renders its honest zero-state.
- A halted or incomplete engagement renders the N/A grade state — never a passing number dressed up by the layout.
- What-changed appears only against a real prior scan of the same target; a first scan says it is a first scan.

## Workflow
1. **Assemble from graded data only.** The findings, tiers, and grade arrive from the evaluator seat; this skill starts at presentation.
2. **Build to the frozen anatomy** with token colors, the spacing scale, and the type scale — components per the rules above.
3. **Self-check before delivering** — run the acceptance checklist below against the actual file, with evidence (greps, measurements, renders), not by memory. A report that has not passed its own checklist is not delivered; it is reported as blocked with the failing item named.

## Acceptance checklist (run every item, every render)
- [ ] Zero external resource references in the produced HTML (grep for `src=`/`href=` asset loads, `@import`, remote `url(...)` — none).
- [ ] Every padding/margin/gap value is on the 4/8/12/16/24/32 scale; nothing touches a panel edge.
- [ ] Type sizes sit on the scale (cover 28–32, section heads 15–17, body 13–14); mono used for IDs/hashes/code; gauge/score numbers tabular.
- [ ] Glass recipe present on panels: translucent white fill, blur(14px) saturate(140%), hairline border, top inner highlight; base is lit zinc, never flat pure black.
- [ ] Every color in the document comes from the token table; severity always paired with its text label.
- [ ] Anatomy complete and in frozen order: cover → posture banner + gauge → executive summary → coverage strip → PROVEN → CONFIRMED → DEFERRED → RULED OUT → fix prompt → audit footer.
- [ ] Motion within limits: gauge sweep, bar growth, card stagger per spec; nothing loops; total entrance ≤ ~1.2s.
- [ ] Print rendering checked: final states only, all sections visible, readable on paper.
- [ ] Reduced-motion rendering checked: static, complete, final states.
- [ ] Data is real: PROVEN appears only with an execution-tier bundle; coverage gaps render as gaps; the grade is the anchored engine's, unaltered.

## Anti-patterns
- Flat opaque panels — solid black cards and hard gray borders where the glass recipe belongs.
- Off-scale spacing (13px, 15px, 20px, 26px paddings) that makes sections crowd their edges — the exact failure that makes a report look improvised.
- Hard-coding a hex the token table defines, or inventing an accent color for decoration.
- Severity or tier carried by color alone, with no text label.
- A second grade, score, or "adjusted" number beside the anchored one — one grading voice, one presented grade.
- Content that only appears after JS runs, or a layout that needs a script to be readable.
- Looping pulses, bounces, or entrance choreography that delays reading.
- Inventing a finding, a coverage claim, or a what-changed baseline to make a section look full.

## Lineage
- **The operator's locked HTML report design skill (html-report-design, locked 2026-10-29)** — *Taken:* the whole design authority — the bar, the five non-negotiables, the glass-on-zinc language, the spacing rhythm, the type scale, the motion system, the component rules, the frozen anatomy, and the acceptance checklist — restated in fleet skill format. The chat-shell section of that skill is deliberately not carried here: it governs a different surface (see When NOT to use).
- **The report token module (`apps/redteam-runner/src/report/html/tokens.ts`)** — *Taken:* the severity and grade hex table, screen and print variants, copied verbatim so a seat rendering by hand uses the same values the writer uses.
- **findings-grading-reporting (sibling fleet skill)** — *Boundary:* that skill owns verdicts, tiers, and the anchored grade; this skill owns only their presentation. The two are bound together on the Reporter seat because the seat that grades also renders — the grade it presents is the grade that skill produced, unaltered.
