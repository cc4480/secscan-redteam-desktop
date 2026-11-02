# Security model

SecScan RedTeam is an offensive security tool. Its security model answers four questions precisely: what may be tested, who decided that, what counts as a finding, and what happens to the secrets and evidence along the way. The mechanisms below are implemented in the tree — the authorization gate in the harness plugin (`packages/redteam/harness-plugin`), the scope and safety layers in the runner (`apps/redteam-runner/src/dispatch`, `apps/redteam-runner/src/safety`) — not aspirational policy.

## Authorization: ownership before offense

Active testing requires an authorization basis recorded on the engagement before anything runs. There are two bases, and they are not interchangeable:

- **Verified domain (web targets).** Ownership is proven with the SecScan service: the operator verifies the domain there (a DNS-based ownership proof in their SecScan account), and the product consults the service's verified-domain list. Verification is **server-authoritative** — the service's `list_verified_domains` answer is the only source of truth. There is deliberately **no local allowlist, no environment-variable override, and no operator checkbox** that can substitute for it: a local assertion mechanism would be a way to claim ownership of someone else's domain from your own disk, which is precisely what the model exists to prevent.
- **Operator attestation (local and lab targets).** A loopback or lab target (a training application on `127.0.0.1`, a VM on the bench) has no domain to verify. Those engagements require explicit operator-side enablement of local targets plus the operator's attestation, recorded on the engagement record with the run. The record — who authorized what, against which target, when — is part of the engagement's audit trail.

## Enforcement points

Authorization is not a launch-screen promise; it is checked where work happens:

- **The auth gate (agent layer).** A `tools/pre-execute` hook in the harness profile intercepts active-testing calls. Before one is allowed, the gate asks the SecScan server for its verified-domain list and allows only listed domains. Any error or timeout in that check **fails closed**: the call is denied. If the SecScan token is unset, the gate has no verification source and active service scans cannot be authorized through it.
- **The scope gate (dispatch layer).** Every tool call the runner executes passes the single `dispatchTool` choke point, where the scope gate extracts the call's actual target — including targets named inside command text — and checks it against the engagement's verified scope (allow semantics over domains, subdomains, and CIDRs, over an explicit deny list). A call outside scope is refused before any packet is sent, and the refusal is written to the engagement record as a `scope_violation` event.
- **Tier gates.** The aggressive test tiers — deep probing, active DAST, API security, and the RED_TEAM modules — fire only when the engagement record carries owner verification. An unverified engagement gets the passive and safe tiers, or none.

## The proof standard

A finding is a claim, and the product grades claims by their receipts. Four states, printed in this order in every report:

| State | Meaning |
|---|---|
| **PROVEN** | Demonstrated end-to-end and captured in an integrity-checked proof bundle (the replayable request/response or command evidence), with a **passing negative control** — the same test against a target state where the flaw is absent does not fire |
| **CONFIRMED** | Independently observed through the confirmation path (a second observation / challenger review of the raw receipts, never of the discoverer's narrative) |
| **DEFERRED** | Plausible and recorded, but not provable within this run's access or time; stated as unproven |
| **RULED OUT** | Tested and cleared; kept on the record so the negative result is auditable |

Two corollaries are load-bearing. **Certainty before demonstration:** the fleet verifies privately and holds the receipt before anything is demonstrated or claimed — claim-first-then-fail is a defect, not a style. **A session alone proves nothing:** sessions open immediately after a successful exploit as a mechanical audit-log step; the session's existence is plumbing, and the finding still needs its bundle and its negative control.

## Safety systems during a run

- **Target-distress circuit breaker.** Error and latency signals from the target trip a breaker that pauses and then halts the run before the fleet can harm a fragile target; auth-lockout signals halt credential testing immediately.
- **Auto-halt conditions.** Defined halt conditions (distress, lockout, scope anomalies) stop the engagement and write the reason to the record. A halted run reports as halted — never as completed.
- **Rate limiting and duplicate guards.** A rate limiter bounds call velocity per target; an exact-duplicate tool call is refused immediately, and near-duplicates stop at two. The fleet cannot flood a target by looping.
- **Non-destructive battery discipline.** The battery's destructive-looking tests are canaried: race tests are single paired requests, uploads carry benign canary content, and no state is left mutated beyond what the application's own normal flows would do.

## Secrets handling

- The operator's service keys (Meta Model API, SecScan, Seclayer) are the product's crown jewels, and the design rule is that **key values never appear in configuration files, source, or logs**. Composed configuration carries key *names* only; values resolve from the credential store or the process environment at spawn time.
- Keys entered in the app are stored in its per-user credential store, encrypted with the OS keychain (Electron `safeStorage`); **on Windows, plaintext storage is refused by design** — if encryption is unavailable, the store fails loudly instead of writing a readable key.
- A rejected key produces exactly one honest error naming the service; the app never enters a prompt/retry loop over a credential, and it never rotates keys on its own. **Revocation lives at the service** (the account settings where the key was minted) and is the operator's kill switch.
- Foundry case capture sanitizes before storage: credentials, tokens, and personal data are stripped from cases, and engagement evidence is written to the local record only.

## Responsible use

Run engagements only against systems you own or are explicitly authorized to test, in writing, by their owner. The verification machinery makes the common accident (testing a domain you merely *use*) structurally difficult, but it does not transfer responsibility: the authorization recorded on the engagement is the operator's assertion, and the audit trail exists so that assertion can be reviewed later. See [SAFETY.md](../../SAFETY.md) for the project's safety notice and [SECURITY.md](../../SECURITY.md) for reporting vulnerabilities in the product itself.
