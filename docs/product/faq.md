# FAQ & troubleshooting

## Using the product

**Which targets may I test?**
Systems you own. For web targets, ownership is proven in-app with a DNS challenge and checked at dispatch time; for local/lab targets (a training app on loopback, a bench VM), local targets must be enabled and the engagement records your attestation. If a target fits neither basis, the product refuses — that refusal is the security model working, not a bug. See [Security model](security-model.md).

**My scan was refused as unverified. What do I do?**
Verify the domain in the app: publish the issued `secscan-verify-…` token as a TXT record at `_secscan-challenge.<domain>`, wait for propagation, and re-run the check. The gate consults the app's local verified-domain record at the moment of the call and fails closed on any error; a failed or incomplete check reads as a refusal, and the engagement record shows the denial.

**Is there a hosted scan service behind the app?**
No. The SecScan engines and the SecLayer suites are embedded in the runner and run on your machine; there is no hosted scan, no service account, and no per-scan credit. The only permitted external fetch in the app is a user-initiated model download from huggingface.co in Local Models.

**Does the native battery need a service key?**
No. There are no scanner keys. Active web engagements require a verified domain (in-app DNS challenge). The only keys the app holds are model-provider keys and the local console/bridge tokens described in [MCP services](mcp-services.md).

**What do PROVEN and CONFIRMED actually mean?**
PROVEN: the flaw was demonstrated end-to-end and the receipt (a replayable proof bundle) passed a negative control. CONFIRMED: independently observed a second time through the challenger path. DEFERRED is "plausible, unproven in this run" and RULED OUT is "tested, cleared". The report orders findings in that sequence and never upgrades a tier silently. Definitions: [Security model](security-model.md#the-proof-standard).

**Why is my grade capped even with few findings?**
The grade is anchored, not averaged: one confirmed critical caps the score at 20 (F) and one confirmed high at 45, regardless of how much else is clean. Conversely, heuristic (unconfirmed) findings are damped and capped, so noise alone cannot fail a target. The full math: [Engines & coverage](engines-and-coverage.md#grading-one-voice).

**Can I run it offline, or keep target data off third-party APIs?**
The battery, the console, and local models work without external scan services. Fleet reasoning needs a model provider: a remote API configured by the operator, or a local model seated through the llama.cpp manager for on-device inference — with the caveat that local-seat capability depends on the chosen model and context window. Domain verification is performed locally by DNS lookup from this machine.

**Is the runner console exposed to my network?**
No. It binds `127.0.0.1` only, requires its token, and the desktop supervisor never listens on a network interface. If you run your own console and point `REDTEAM_MCP_URL` at it, you own that exposure decision — treat the endpoint as what it is: a remote control for live testing tools.

## Keys and connections

**Where are my keys stored, and how do I revoke one?**
In the app's per-user credential store, encrypted with the OS keychain (`safeStorage`); on Windows the store refuses plaintext storage outright. Revoke provider keys at the provider that minted them — revocation takes effect at the next call. See [MCP services](mcp-services.md#keys-and-credentials).

**Where are the Seclayer tools?**
Inside engagements. The SecLayer suites are native runner tools (`seclayer_redteam`, `seclayer_bola`, `seclayer_api`, `seclayer_webhook`, `seclayer_dast`, `seclayer_aggressive`), not chat-session tools and not a separate server: the fleet calls them as part of an engagement's battery, with no key and no setup. Blind SSRF/out-of-band checks report as not-run because the native suites carry no OOB collaborator.

**My domain still shows unverified.**
The app checks for a TXT record at `_secscan-challenge.<domain>` carrying the exact `secscan-verify-…` token it issued. Publish that record at your DNS provider, give it time to propagate, and re-run the check in the app. A record on the wrong name, a token from an earlier challenge, or provider-added quoting/formatting issues are common causes; the check fails closed until the record matches exactly.

**A run died when the model provider hiccuped. Should it have?**
No — the resilience layer exists for classified failover, credential-pool rotation, and cooldowns to degrade speed, not kill the run. If a run died on a transient provider error, capture the engagement record and the classified reason from the feed; that is a defect report worth filing. A missing key fails fast and honestly by design.

## Running engagements

**The engagement halted mid-run. Why?**
Read the reason in the record — the status tool and the feed carry it. Designed causes include the target-distress circuit breaker (the target started erroring or slowing under load), an auth-lockout signal during credential testing, or a scope anomaly. A halted run reports as halted, with its partial coverage stated; it never reports as complete.

**The report says coverage is incomplete.**
Then it is: the engagement could not finish part of the battery (time, access, or a halt), and the report names the pending classes rather than implying a clean pass. Re-run, widen access (credentials, a second account for IDOR tiers), or re-verify specific findings with `reverify`.

## Installation

**Windows warns me the installer is unsigned.**
Expected for unsigned CI builds. Verify the installer came from the project's release, then confirm through the prompt. Signed builds are produced on a machine with the signing token.

**The app says the runner console failed to start.**
The desktop supervisor treats that as a visible startup failure rather than starting the chat without its engine. Usual causes: a stale `REDTEAM_MCP_URL`/`REDTEAM_UI_TOKEN` override pointing at nothing, or a local security product blocking the loopback listener. Clear the overrides, restart, and check the startup error the app shows.
