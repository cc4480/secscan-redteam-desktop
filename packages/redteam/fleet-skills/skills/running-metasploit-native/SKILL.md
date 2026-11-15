---
name: running-metasploit-native
description: 'Run Metasploit-grade exploitation using native tools and fleet technique skills only. Use only when a confirmed finding exists from nmap, nuclei, SecScan, or SecLayer and the coordinator orders exploitation against verified engagement scope.'
domain: cybersecurity
subdomain: exploitation
tags: [metasploit, native, exploitation, windows, linux, mobile]
version: '1.0'
author: secscan
license: Apache-2.0
nist_csf: [DE.CM, RS.AN, PR.IP]
mitre_attack: [T1190, T1210, T1059, T1068]
---
# Running Metasploit Native

## When to Use
Use only after a confirmed finding exists and the coordinator orders exploitation on verified engagement scope.
**Do not use** for initial recon, vulnerability scanning, unconfirmed findings, or against any target outside verified engagement scope. Do not use any external Metasploit MCP server or msfrpcd.

## Procedure
1. Apply standing rules:
   - Standalone: exploitation capability is inside the app using native tools and fleet technique skills. No external Metasploit MCP server or msfrpcd is ever a prerequisite. Absence of SecScan/SecLayer/Metasploit connectivity changes nothing.
   - Scope: verified engagement scope only; zero packets outside it. "Local machine" means the host the app runs on, resolved by default; never ask which machine. A URL target routes to the web-facing scanners in kind.
   - Chaining: nmap services feed nuclei templates and SecScan checks; confirmed findings feed exploitation skills; everything feeds the HTML report with its source label.
   - Discipline: report only what tool output proved. "no evidence / not run" is a valid result. Never upgrade an unconfirmed claim to a finding. Every finding carries evidence: command, output excerpt, timestamp.
2. Require a confirmed finding:
   - Set `FINDING_ID` to the confirmed finding from nmap, nuclei, SecScan, or SecLayer.
   - Confirm the finding grade is `confirmed`. If not, stop and record `not-run` with reason: unconfirmed finding is not eligible for exploitation.
3. Select exploit technique from confirmed finding:
   - Query the fleet technique skills for a native technique matching the service, product, version, or CVE in the finding.
   - For Windows targets: select Windows native exploitation techniques. For Linux targets: select Linux native exploitation techniques. For mobile targets: select mobile-specific techniques only for a mobile target.
   - Do not select a technique that targets a different service or product.
   - Set `SELECTED_TECHNIQUE` to the matching technique skill name.
4. Execute native exploitation:
   - Call `native.metasploit.exploit(finding_id=FINDING_ID, technique=SELECTED_TECHNIQUE)`.
   - The native runner uses in-app tools and the selected fleet technique skill. It does not connect to any external Metasploit MCP server or msfrpcd.
5. Handle sessions and evidence:
   - Call `native.metasploit.session.list` to confirm a session or proof of code execution.
   - If no session or proof is returned, record `no-evidence` and do not report success.
   - Call `native.metasploit.session.cleanup` at completion or if the operation is aborted.
6. Report:
   - Write only successful, evidence-backed exploitation results to the HTML report under source label `metasploit-native`.
   - Include command, full output excerpt, timestamp, finding id, technique, session id, and success or failure.
   - If exploitation fails or is not run, report that as a valid result; do not create a finding.
7. Chain:
   - Confirmed nmap, nuclei, SecScan, and SecLayer findings are the only inputs to this skill.
   - All exploitation output feeds the final HTML report under `metasploit-native`.
