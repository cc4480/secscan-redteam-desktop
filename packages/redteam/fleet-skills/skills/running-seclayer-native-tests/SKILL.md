---
name: running-seclayer-native-tests
description: 'Run the embedded in-process SecLayer web/app test tools (seclayer_redteam, seclayer_bola, seclayer_api, seclayer_webhook, seclayer_dast, seclayer_aggressive). Use when the coordinator orders SecLayer tests or when deeper in-process evidence is needed after SecScan checks on a verified in-scope URL.'
domain: cybersecurity
subdomain: security-testing
tags: [seclayer, native, in-process, testing]
version: '1.1'
author: secscan
license: Apache-2.0
nist_csf: [DE.CM, RS.AN, PR.IP]
mitre_attack: [T1595, T1203, T1557]
---
# Running SecLayer Native Tests

## When to Use
Use when the coordinator orders SecLayer tests or when SecScan checks need deeper in-process web/application evidence on a verified in-scope target.
**Do not use** for initial host discovery, initial web template scanning, final exploitation, or any target outside verified engagement scope.

## Procedure
1. Apply standing rules:
   - Standalone/native: SecLayer modules are embedded in the app and run in-process through `seclayer_*` tools. No external security-tool MCP servers are required for these tools (runner/AlterEgo hops are separate exceptions elsewhere).
   - Scope: verified engagement scope only; zero packets outside it. These tools target one in-scope root/target URL (`url`) unless a parameter explicitly takes discovered in-scope paths/URLs.
   - Verification gate: every `seclayer_*` tool runs active web app tests and is verification-gated. The runner refuses calls without owner verification on the engagement record; obtain/confirm verification before calling.
   - Blind OOB behavior: blind/out-of-band checks use an in-process loopback collaborator for loopback targets only. For remote targets that cannot receive callbacks in this build, the blind class must be reported honestly as `not-run`/not provable (not a confirmed hit).
   - Discipline: report only what tool output proved. "no evidence / not run" is a valid result. Never upgrade an unconfirmed claim to a finding. Every finding carries evidence: tool call, output excerpt, timestamp.
2. Common call fields:
   - `url` (required): one in-scope target root URL.
   - `category` (required): `logic`, `functionality`, or `validation`.
   - `attackId`, `targetProfile` (`secscan`, `seclayer`, `webapp`, `windows`, `linux`), `hypothesis`: include when known/appropriate.
   - `headers` (optional): base request headers as a JSON object of string values (e.g. authenticated session Cookie/Authorization).
   - Include `batteryItem` and `variantIndex` when applicable.
3. Choose the correct tool:
   - `seclayer_redteam`: RED_TEAM probe set (SQL injection, reflected XSS, OS command injection, reflected SSRF, and blind SSRF). Returns proven hits only for provable signals/receipts.
   - `seclayer_bola`: two-identity BOLA/IDOR probe. Requires `aAuthHeader`, `aOwnResource`, `bAuthHeader`, `bOwnResource`; optional `aOwnMarker`, `bOwnMarker`. A confirmed BOLA result requires all proof legs the tool enforces.
   - `seclayer_api`: API_SEC flow (GraphQL introspection exposure, query-cost/alias amplification controls, exposed user/credential list detection). If both test identities are supplied (`a*/b*`, same as `seclayer_bola`), includes the two-identity BOLA probe in the flow.
   - `seclayer_webhook`: webhook signature-bypass probe for bad-signature deliveries (e.g. Stripe/Svix-style candidates plus discovered endpoints). Optional `postUrls` adds discovered POST endpoints.
   - `seclayer_dast`: one DAST-unique probe selected by `probe` (`csrf`, `stored_xss`, `dom_xss`, `price_manipulation`, `prototype_pollution`, `deserialization`, `credential_chain`, `auth_rate_limit`, `llm`, `edge_function`, `i18n`, `weak_session`). Supply only the discovery inputs needed by that probe (e.g. `formTargets`, `postUrls`, `cookieLines`, `forms`, `texts`, `paths`, `pageText`, `pairs`, `discovered`, `loginTarget`, `username`, `password`) as defined by the tool schema.
   - `seclayer_aggressive`: one aggressive probe selected by `probe` (`ssti`, `nosql`, `xxe`, `crlf`, `host_header`). Each returns a finding only when it proves the technique; blind XXE OOB follows loopback-only collaborator limits.
4. Execute and record:
   - Call the selected `seclayer_*` tool with required params and relevant optional inputs. Each call runs in-process; no external browser/service is required by the tool itself.
   - Record: tool name, probe/family selected, target URL, inputs supplied, output excerpts, timestamps, and any refusal/not-run reason (including verification refusal or remote blind-OOB not-run).
5. Report and chain:
   - Attribute results to SecLayer as produced by the runner/app reporting pipeline. Do not label nmap, nuclei, or SecScan results as SecLayer.
   - Run SecLayer after SecScan checks when deeper in-process evidence is needed; it does not replace broad SecScan coverage.
   - If a SecLayer finding is confirmed and exploitation is ordered, run `running-metasploit-native`.
