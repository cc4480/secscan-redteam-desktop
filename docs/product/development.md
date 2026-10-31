# Development guide

This guide covers the repository as a place to work: its layout, the packages that carry the product, and the house rules. Platform-level contribution setup is in [`docs/development.md`](../development.md) and [`CONTRIBUTING.md`](../../CONTRIBUTING.md); documentation work follows [`docs/AGENTS.md`](../AGENTS.md).

## Repository layout

```
apps/
  desktop/          the installed product (Electron): supervisor, welcome/settings, credential store, local models
  redteam-runner/   the engagement engine + loopback console (battery, dispatch, proof, reports, Foundry)
  cli/              the `dsh` command-line entry
  web/              the harness web application
  desktop-host/     desktop host plumbing
  pc-agent-bridge/  the AlterEgo PC bridge endpoint the fleet can drive
packages/
  redteam/          the product layer (below)
  <groups>/         the harness platform: core, llm, mcp, session, client, experimental, ...
vendor/             vendored Cordis (vendor/README.md)
docs/               platform references + docs/product/ (this set)
scripts/            build, gates, and generators
website/            the VitePress documentation projection
```

## The redteam packages (`packages/redteam/`)

| Package | Contract |
|---|---|
| `harness-plugin` | The fleet's harness face: the authorization gate hook, the engagement doctrine prompt section (services inventory, second-opinion rules, the SOUL layer's seat), the role definitions in `agents/` (`coordinator`, `recon`, `exploiter`, `architect`, `reporter`, `_shared-base`), and the redteam profile |
| `llm-router` | Provider registry (Meta Model API primary), per-role seat policy, charter composition, and the resilience wrapper |
| `desktop-bundle` | The Cordis bundle patch that composes the product into a profile: the three MCP rows, the harness plugin, and the agent-team rows with the fleet bounds |
| `auth-gate` | The verification decision library behind the gate hook: server-authoritative domain checks against the SecScan service |
| `foundry-gate` | The Foundry's gate package and its frozen starter snapshot: candidate evaluation for the Gold Loop |
| `scripts` | Redteam build utilities (including the runner dist-hash/stamp tooling) |

The runner's own internals — battery trees (`src/secscan`, `src/seclayer`, kept as-is with hash manifests), dispatch, safety, proof, report, continuous, foundry, harness2 — live in `apps/redteam-runner/src` and are documented at product level in this set ([Engines & coverage](engines-and-coverage.md), [Architecture](architecture.md)).

## House rules

The root [`AGENTS.md`](../../AGENTS.md) is the standing-orders file and wins on process. The rules that shape redteam work:

- **Everything is a plugin.** Product behavior is composed through Cordis bundles, profiles, and hooks — not by forking the harness core. Read [`docs/architecture.md`](../architecture.md) before changing `packages/`.
- **Only `dsh` profiles launch supported Node apps**; package bins and SDK argv escapes are not launch paths.
- **Never commit credentials.** Keys exist only in the credential store or the process environment. Composed configuration carries key names, never values — a diff that adds a value is a stop-and-fix, not a review comment.
- **Public APIs are pre-stable**: change a contract, update every consumer in the same change.
- **Match evidence to the surface.** Focused tests for focused changes; `pnpm run doc-sync` for documentation; the full suite is CI's job, not a local default.
- **Product surface claims need product surface proof.** A feature counts when it works through the app an operator opens — the chat — not when its files exist or its unit tests pass.

## Commands

```sh
pnpm install                 # workspaces; node ^22.19 || >=24
pnpm run build               # full library build (host + client faces)
pnpm run dev:desktop         # build + launch the desktop app (start:desktop skips the build)
pnpm run test                # unit tests
pnpm run typecheck           # tsc project references
pnpm run lint                # oxlint over the tree
pnpm run doc-sync            # documentation gates
pnpm run test:redteam-runner # the runner's suite (build + node --test) — see root package.json
```

Per-package suites run from each package's own scripts; the verification habit in this project is to baseline the packages a change touches before editing, and to re-run exactly those suites after.
