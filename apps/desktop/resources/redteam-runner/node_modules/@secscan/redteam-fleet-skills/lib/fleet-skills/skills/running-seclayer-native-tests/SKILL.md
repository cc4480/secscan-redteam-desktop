---
name: running-seclayer-native-tests
description: 'Run the native SecLayer test module families in-process. Use when the coordinator orders SecLayer tests or when deeper in-process evidence is needed after SecScan checks for a URL, remote service, or local machine in verified engagement scope.'
domain: cybersecurity
subdomain: security-testing
tags: [seclayer, native, in-process, testing]
version: '1.0'
author: secscan
license: Apache-2.0
nist_csf: [DE.CM, RS.AN, PR.IP]
mitre_attack: [T1595, T1203, T1557]
---
# Running SecLayer Native Tests

## When to Use
Use when the coordinator orders SecLayer tests or when SecScan checks need deeper in-process test-family evidence on a verified scope target.
**Do not use** for initial host discovery, initial web template scanning, final exploitation, or any target outside verified engagement scope.

## Procedure
1. Apply standing rules:
   - Standalone: the SecLayer test module is inside the app. No external service connection is ever a prerequisite. Absence of SecScan/SecLayer/Metasploit connectivity changes nothing.
   - Scope: verified engagement scope only; zero packets outside it. "Local machine" means the host the app runs on, resolved by default; never ask which machine. A URL target routes to the web-facing scanners in kind.
   - Chaining: nmap services feed nuclei templates and SecScan checks; confirmed findings feed exploitation skills; everything feeds the HTML report with its source label.
   - Discipline: report only what tool output proved. "no evidence / not run" is a valid result. Never upgrade an unconfirmed claim to a finding. Every finding carries evidence: command, output excerpt, timestamp.
2. Confirm target and test family:
   - Set `TARGET` to the verified scope target.
   - Set `TARGET_TYPE` to one of: `url`, `remote-host`, `local-machine`.
   - Choose a SecLayer test family that matches the target:
     - `web-input`: input validation, injection, header/body handling.
     - `http-transport`: TLS/HTTP behavior, redirects, method handling.
     - `network-protocol`: protocol fields, handshake, malformed packets.
     - `config-compliance`: local or service configuration checks.
     - `credential-exposure`: exposed credentials, tokens, or secrets.
     - `local-binary`: local process, library, or binary behavior.
   - Set `FAMILY` to the selected family.
3. Run the SecLayer test in-process:
   - Call `native.seclayer.test(target=TARGET, family=FAMILY)`.
   - The module runs inside the app process using its embedded web client, protocol library, or local process runner. No external browser or service is required.
4. Score under the anchored engine:
   - Each test family defines an anchor condition, such as an expected change, response, or file state.
   - If tool output matches the anchor, record the result with grade `confirmed`, `probable`, or `possible`.
   - If no match or no run occurs, record `no-evidence` or `not-run`. Never upgrade.
5. Report and chain:
   - Write findings to the HTML report under source label `seclayer`.
   - Run SecLayer after SecScan checks when deeper in-process evidence is needed; do not substitute it for the full 238-check SecScan engine.
   - If a SecLayer finding is confirmed and exploitation is ordered, run `running-metasploit-native`.
   - Do not label nmap, nuclei, or SecScan results as `seclayer`.
