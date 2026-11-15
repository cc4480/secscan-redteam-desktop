---
name: running-nuclei-native-scan
description: 'Run nuclei through the in-app native adapter native.nuclei.scan. Use when discovered services or web targets need vulnerability template scanning from the local templates directory, or when the coordinator orders nuclei on a URL or host in verified engagement scope.'
domain: cybersecurity
subdomain: vulnerability-scanning
tags: [nuclei, native, template, vulnerability-scan]
version: '1.0'
author: secscan
license: Apache-2.0
nist_csf: [ID.RA, DE.CM, RS.AN]
mitre_attack: [T1595, T1190, T1210]
---
# Running Nuclei Native Scan

## When to Use
Use when nmap or SecScan has discovered services and the next step is template-based vulnerability scanning, or when the coordinator orders nuclei on a verified scope URL or host.
**Do not use** for host discovery, for full SecScan check suite replacement, for exploitation, or against any target outside verified engagement scope.

## Procedure
1. Apply standing rules:
   - Standalone: the nuclei capability is inside the app through the native adapter `native.nuclei.scan`. No external nuclei service or MCP server is ever a prerequisite. Absence of SecScan/SecLayer/Metasploit connectivity changes nothing.
   - Scope: verified engagement scope only; zero packets outside it. "Local machine" means the host the app runs on, resolved by default; never ask which machine. A URL target routes to the web-facing scanners in kind.
   - Chaining: nmap services feed nuclei templates and SecScan checks; confirmed findings feed exploitation skills; everything feeds the HTML report with its source label.
   - Discipline: report only what tool output proved. "no evidence / not run" is a valid result. Never upgrade an unconfirmed claim to a finding. Every finding carries evidence: command, output excerpt, timestamp.
2. Collect discovered services:
   - Set `TARGET` to the verified scope target.
   - Use service data from `running-nmap-native-scan` or SecScan output.
   - Set `SERVICE` to the discovered service for the target, such as `http`, `https`, `ssh`, `ftp`, `rdp`, `smb`, or `dns`.
3. Select templates by discovered service:
   - Set `TEMPLATES_DIR` to the local templates directory already present in the app (`data/nuclei-templates/`). Never download external templates.
   - Map service to tags:
     - `http` or `https`: `cve`, `misconfiguration`, `exposure`, `tech`, `http`.
     - `ssh`, `ftp`, `rdp`, `smb`: `cve`, `misconfiguration`, `network`.
     - `dns`: `dns`, `takeover`.
   - Set `SELECTED_TAGS` to the selected tags for `SERVICE`.
   - Select only templates whose metadata matches `SERVICE` and `SELECTED_TAGS`.
4. Execute nuclei:
   - Call `native.nuclei.scan(target=TARGET, templates=TEMPLATES_DIR, tags=SELECTED_TAGS, service=SERVICE)`.
   - For a URL target, pass the URL exactly as supplied in scope and use the web-facing tags.
5. Parse JSONL output:
   - Parse each JSONL line from the adapter output.
   - Required fields: `template-id`, `matched-at`, `matcher-name`, `info`, `severity`, `host`, `timestamp`.
   - Normalize each line into a finding with `source_label=native-nuclei`.
6. Deduplicate:
   - Deduplicate by the key `template-id + matched-at + matcher-name`.
   - Keep only the first finding for that key on the same target.
   - Do not merge findings across different targets, ports, or URLs.
   - Mark later duplicates as duplicates and do not create new findings.
7. Report and chain:
   - Write findings to the HTML report under source label `native-nuclei`.
   - Include evidence for each finding: command, JSONL output excerpt, timestamp.
   - If no templates match, record `no-evidence` or `not-run` as the valid result.
   - If a nuclei finding is confirmed and exploitation is ordered, run `running-metasploit-native`.
   - All results feed the final HTML report under `native-nuclei`.
