# @secscan/redteam-fleet-skills

Fleet skills library + prompt assembly for SecScan RedTeam. This package carries the fleet's nine bundled skills (`skills/<name>/SKILL.md` — deep research/OSINT, web app scan, web app exploit, red-team ops coordination, black-team adversary emulation, exploit coding/toolbuilding, browser action execution, findings grading/reporting, HTML report design), the prompt assets under `prompts/` (the master prompt, seat deltas, and the souls — including `prompts/souls/scribe.md`, the SCRIBE, the dedicated report-writing/signing seat the runner assembles as role `publisher`, and `prompts/souls/trinity.md`, Trinity, the evidence-reporting seat), and the TypeScript that serves them: the skill registry (`src/registry.ts`, `src/frontmatter.ts`), the verified-engagement record and its prompt injection block (`src/engagement.ts`), operator knobs (`src/knobs.ts` — including `SCRIBE_MAX_CYCLES`, the Scribe's reject/rewrite budget, default 2), seat prompt assembly (`src/assemble.ts`), the tool guard (`src/tool-guard.ts`), and step containment (`src/containment.ts`).

## Seat and soul mapping

Prompt assets are assembled as `master → soul → verified engagement injection → knobs → seat delta → skills index → skill bodies` (`assembleFleetPrompt`). Souls carry persona/drive; seat deltas narrow the operational role; both remain subordinate to the master, engagement record, and proof contracts.

- **Trinity (reporting/evidence):** `prompts/souls/trinity.md` + `prompts/seats/trinity.md`. States evidence exactly as proven with traceability and coverage honesty; owns evidence narrative/report content, but defers grade authority to the anchored evaluator flow and final sign-off to the Scribe/publisher.
- **Scribe (signing/publishing):** `prompts/souls/scribe.md` + `prompts/seats/publisher.md` (publisher seat). Owns artifact-set reconciliation/fidelity, sign/reject/UNSIGNED verdicts, and the `SCRIBE_MAX_CYCLES` reject/rewrite budget; does not probe, re-run, or invent content.
- **Evaluator-reporter (legacy/combined path):** `prompts/seats/evaluator-reporter.md` remains the combined grading-and-rendering seat delta used by existing reporter flows. Trinity/Scribe assets add an explicit reporting-vs-signing split additively; existing evaluator-reporter behavior is retained.
- **Agent Smith (mask, not a seat):** `prompts/souls/smith.md` documents Smith as a black-team mask worn by a seat for the duration of an exercise, not a standing crew seat. Blueprint language may name Smith as a formal-review role; this package keeps the current mask semantics intact and treats any promotion to a standing formal-review seat/runtime member as a follow-up, non-breaking clarification.

## How skills load: three layers

- **Layer 1 — index, always in context.** `skillIndexBlock()` renders a `<fleet_skills_index>` block listing each skill's name and trigger description only. A seat decides which skill matches from the descriptions.
- **Layer 2 — body, on trigger.** `loadSkillBody()` returns the full `SKILL.md` text; reading it is a required step before the seat uses that skill's tool family.
- **Layer 3 — references, on demand.** `listReferences()` enumerates a bundle's `references/`, `scripts/`, and `assets/` files; a file is loaded only when a step names it.

Discovery (`discoverSkills(roots)`) takes precedence-ordered roots: when two roots carry the same skill name, the earlier root shadows the later one, so an engagement-specific variant overrides the bundled library without editing it. `bundledSkillsRoot()` resolves this package's own `skills/` directory. Frontmatter parsing and discovery fail loud — a skill with missing or invalid name/description, or a name that does not match its directory, throws naming the file instead of being silently skipped.

## Status

Version 0.1.0, private, in active build: the registry, engagement, knobs, assembly, tool-guard, and containment modules are landing together, each with `node:test` coverage under `test/`. Not yet wired into the desktop app's runtime. This package publishes no `./invariant` companion: it owns no relation between independent observations that could diverge.
