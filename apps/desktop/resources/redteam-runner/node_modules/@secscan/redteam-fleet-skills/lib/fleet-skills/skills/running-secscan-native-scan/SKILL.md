---
name: running-secscan-native-scan
description: 'Run the native SecScan engine that contains 238 in-app check modules. Use when the coordinator orders SecScan scanning or when confirmed service and application enumeration from nmap or nuclei indicates that SecScan checks should run against a URL, host, or local machine in verified engagement scope.'
domain: cybersecurity
subdomain: vulnerability-scanning
tags: [secscan, native, vulnerability-check, scanner]
version: '1.0'
author: secscan
license: Apache-2.0
nist_csf: [ID.RA, DE.CM, RS.AN]
mitre_attack: [T1595, T1190, T1210]
---
# Running SecScan Native Scan

## When to Use
Use when the coordinator orders SecScan scanning or when nmap or nuclei output has confirmed services/applications and the next step is SecScan checks in verified scope.
**Do not use** for initial host discovery, for template-based web vulnerability scanning when nmap or nuclei should run first, or against any target outside verified engagement scope.

## Procedure
1. Apply standing rules:
   - Standalone: the SecScan engine is inside the app. No external service connection is ever a prerequisite. Absence of SecScan/SecLayer/Metasploit connectivity changes nothing.
   - Scope: verified engagement scope only; zero packets outside it. "Local machine" means the host the app runs on, resolved by default; never ask which machine. A URL target routes to the web-facing scanners in kind.
   - Chaining: nmap services feed nuclei templates and SecScan checks; confirmed findings feed exploitation skills; everything feeds the HTML report with its source label.
   - Discipline: report only what tool output proved. "no evidence / not run" is a valid result. Never upgrade an unconfirmed claim to a finding. Every finding carries evidence: command, output excerpt, timestamp.
2. Set target and access depth:
   - Set `TARGET` to the verified scope target exactly as provided.
   - Set `TARGET_TYPE` to one of: `url`, `remote-host`, `local-machine`.
   - Set `ACCESS_DEPTH` to one of: `network`, `credentialed`, `local`.
   - If `TARGET_TYPE` is `local-machine`, use the app host by default; never ask which machine.
3. Select checks by target type and access depth:
   - For `url`: enable web/HTTP/TLS checks, injection checks, and application-specific checks.
   - For `remote-host`: enable network service checks, product/version checks, known CVE checks.
   - For `local-machine`: enable local process, patch, configuration, and credential exposure checks.
   - Run only checks from the 238 in-app SecScan modules whose metadata matches `TARGET_TYPE` and `ACCESS_DEPTH`.
4. Execute the SecScan engine:
   - Call `native.secscan.scan(target=TARGET, target_type=TARGET_TYPE, access_depth=ACCESS_DEPTH)`.
   - Record for every executed check: check id, command, output excerpt, timestamp.
5. Grade findings with the anchored engine:
   - Each check module defines an anchor condition, such as a version string, vulnerable response, or file state.
   - If tool output matches the anchor, record a finding with the check severity and grade `confirmed`, `probable`, or `possible`.
   - If tool output does not match the anchor, record `no-evidence` or `not-run`. Never upgrade an unconfirmed claim.
6. Feed the report and chain:
   - Write results to the HTML report under source label `secscan`.
   - If host discovery or service/version data is missing, run `running-nmap-native-scan`.
   - If discovered web services need template checks, run `running-nuclei-native-scan`.
   - If deeper in-process testing is needed, run `running-seclayer-native-tests`.
   - If a confirmed finding exists and exploitation is ordered, run `running-metasploit-native`.
   - Do not label nmap or nuclei results as `secscan`.
