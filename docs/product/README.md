# SecScan RedTeam — product documentation

This directory is the product documentation for SecScan RedTeam: what the product is, how it is put together, how it decides what it may test, and how an operator configures and builds it. The agent-harness platform underneath the product keeps its own references in [`docs/`](../architecture.md) (platform architecture, subsystems, the Cordis API, and the contributor guides); this set describes the product and links into the platform references where they are authoritative.

| Document | Contents |
|---|---|
| [Overview](overview.md) | The product in one read: surfaces, design principles, the Foundry loop, target types |
| [Architecture](architecture.md) | The fleet of five, the engagement lifecycle, the desktop app / harness / runner composition |
| [Security model](security-model.md) | Ownership verification, scope enforcement, verification-gated tiers, the proof standard, safety systems, secrets handling |
| [Engines & coverage](engines-and-coverage.md) | The native SecScan/Seclayer battery, the hypothesis battery, external engines, anchored grading, continuous watch |
| [MCP services](mcp-services.md) | The SecScan and Seclayer service connections and the runner console endpoint: tools, keys, storage, failure shapes |
| [Models](models.md) | Meta Model API seats, the provider-resilience layer, the llama.cpp local-model manager |
| [Configuration](configuration.md) | Environment variables, the credential store, fleet bounds, profile patch overrides, console settings |
| [Build & install](build-and-install.md) | Building from source, the vendored tool payload, and the Windows installer CI pipeline |
| [Development guide](development.md) | Repository layout, the redteam packages, build/test commands, and the house rules |
| [FAQ & troubleshooting](faq.md) | Ownership refusals, missing tools, rejected keys, and other operator questions |

Brand usage for anything produced from this repository is defined in [`BRAND_GUIDELINES.md`](../../BRAND_GUIDELINES.md). The front page is the repository [`README.md`](../../README.md).
