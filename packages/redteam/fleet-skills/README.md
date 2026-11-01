# @secscan/redteam-fleet-skills

Fleet skills library + prompt assembly for SecScan RedTeam. This package carries the fleet's nine bundled skills (`skills/<name>/SKILL.md` — deep research/OSINT, web app scan, web app exploit, red-team ops coordination, black-team adversary emulation, exploit coding/toolbuilding, browser action execution, findings grading/reporting, HTML report design), the prompt assets under `prompts/`, and the TypeScript that serves them: the skill registry (`src/registry.ts`, `src/frontmatter.ts`), the verified-engagement record and its prompt injection block (`src/engagement.ts`), operator knobs (`src/knobs.ts`), seat prompt assembly (`src/assemble.ts`), the tool guard (`src/tool-guard.ts`), and step containment (`src/containment.ts`).

## How skills load: three layers

- **Layer 1 — index, always in context.** `skillIndexBlock()` renders a `<fleet_skills_index>` block listing each skill's name and trigger description only. A seat decides which skill matches from the descriptions.
- **Layer 2 — body, on trigger.** `loadSkillBody()` returns the full `SKILL.md` text; reading it is a required step before the seat uses that skill's tool family.
- **Layer 3 — references, on demand.** `listReferences()` enumerates a bundle's `references/`, `scripts/`, and `assets/` files; a file is loaded only when a step names it.

Discovery (`discoverSkills(roots)`) takes precedence-ordered roots: when two roots carry the same skill name, the earlier root shadows the later one, so an engagement-specific variant overrides the bundled library without editing it. `bundledSkillsRoot()` resolves this package's own `skills/` directory. Frontmatter parsing and discovery fail loud — a skill with missing or invalid name/description, or a name that does not match its directory, throws naming the file instead of being silently skipped.

## Status

Version 0.1.0, private, in active build: the registry, engagement, knobs, assembly, tool-guard, and containment modules are landing together, each with `node:test` coverage under `test/`. Not yet wired into the desktop app's runtime. This package publishes no `./invariant` companion: it owns no relation between independent observations that could diverge.
