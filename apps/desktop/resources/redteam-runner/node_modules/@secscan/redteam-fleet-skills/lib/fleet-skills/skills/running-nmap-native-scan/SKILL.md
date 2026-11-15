---
name: running-nmap-native-scan
description: 'Run nmap through the in-app native adapter native.nmap.scan. Use when host discovery, service and version detection, or NSE vulnerability scanning is needed for a host, URL, or local machine in verified engagement scope.'
domain: cybersecurity
subdomain: network-reconnaissance
tags: [nmap, native, recon, service-discovery]
version: '1.0'
author: secscan
license: Apache-2.0
nist_csf: [ID.AM, DE.CM, ID.RA]
mitre_attack: [T1595, T1046, T1018]
---
# Running Nmap Native Scan

## When to Use
Use when the coordinator orders nmap or when host discovery, service/version detection, or NSE vulnerability scanning is needed before nuclei or SecScan checks.
**Do not use** for direct exploitation, for template-based web vulnerability scanning when services are already known, or against any target outside verified engagement scope.

## Procedure
1. Apply standing rules:
   - Standalone: the nmap capability is inside the app through the native adapter `native.nmap.scan`. No external nmap service or MCP server is ever a prerequisite. Absence of SecScan/SecLayer/Metasploit connectivity changes nothing.
   - Scope: verified engagement scope only; zero packets outside it. "Local machine" means the host the app runs on, resolved by default; never ask which machine. A URL target routes to the web-facing scanners in kind.
   - Chaining: nmap services feed nuclei templates and SecScan checks; confirmed findings feed exploitation skills; everything feeds the HTML report with its source label.
   - Discipline: report only what tool output proved. "no evidence / not run" is a valid result. Never upgrade an unconfirmed claim to a finding. Every finding carries evidence: command, output excerpt, timestamp.
2. Resolve the target:
   - Set `TARGET` to the verified scope target.
   - If `TARGET` is a URL, run nmap against the URL hostname and relevant in-scope ports, typically 80 and 443, not against unrelated hosts.
   - If `TARGET` is `local-machine`, use the app host by default; never ask which machine.
3. Run the required scan profiles:
   - Host discovery: `native.nmap.scan(target=TARGET, profile="host-discovery")`
   - Service and version detection: `native.nmap.scan(target=TARGET, profile="service-version", ports="top-1000")`
   - NSE vulnerability scanning: `native.nmap.scan(target=TARGET, profile="nse-vuln", scripts="vuln")`
   - Run only profiles needed for the current step. Use `ports="1-65535"` only if explicitly authorized in the engagement scope.
4. Parse XML output:
   - Parse the XML output from the adapter into normalized findings.
   - Required finding fields: `host`, `port`, `protocol`, `state`, `service`, `product`, `version`, `script`, `script_output`, `timestamp`, `source_label=native-nmap`.
   - Include the raw output excerpt for each open, filtered, or vulnerable port.
5. Record coverage:
   - Record which `TARGET`, scan profile, port range, timestamp, and XML output path were used.
   - Mark unexecuted profiles as `not-run`.
   - If the scan did not produce output for a requested profile, record `no-evidence`.
6. Feed report and chain:
   - Write findings to the HTML report under source label `native-nmap`.
   - Confirmed open services and detected products feed `running-nuclei-native-scan` for template selection by service and `running-secscan-native-scan` for check selection by service/product.
   - Do not perform exploitation from nmap alone; use `running-metasploit-native` only after a confirmed vulnerability finding exists.
   - Do not attach nmap results to other source labels.
