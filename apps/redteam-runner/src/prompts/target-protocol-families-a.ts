/**
 * Target-family protocols for the web application and Windows host families.
 * Split from target-protocol.ts to keep each file inside the runner's 300-line
 * budget; the protocol text is unchanged.
 */

import type { TargetProtocol } from './target-protocol.js'

/** Web application / API. */
export const WEBAPP: TargetProtocol = {
  family: 'webapp',
  label: 'Web application / HTTP API',
  intelligence: [
    'Scheme, host, port and TLS posture',
    'Server + framework fingerprint and version',
    'Auth model: anonymous, session, token, SSO',
    'Route surface: linked pages, forms, JSON endpoints',
  ],
  confirm: 'HTTP(S) endpoint answers; server/framework fingerprint readable.',
  steps: [
    {
      id: 'WEB-01',
      title: 'Passive scan + fingerprint',
      owner: 'recon',
      tools: ['secscan_exec', 'bridge_http_headers', 'bridge_tls_info', 'bridge_dns_query'],
      collect: ['server/framework versions', 'TLS posture', 'security headers', 'cookies and their flags', 'robots/sitemap/exposed files'],
      done: 'Stack and entry surface are named, with the scan report kept as evidence.',
      evidence: 'scan report + header/TLS capture',
    },
    {
      id: 'WEB-02',
      title: 'Route and parameter inventory',
      owner: 'recon',
      tools: ['ffuf_exec', 'nikto_exec', 'http_probe'],
      collect: ['paths and status codes', 'parameters per route', 'auth-gated vs public routes', 'alternate methods'],
      done: 'Every parameter the exploiter will mutate is on the shared target map with a route and auth state.',
      evidence: 'discovery output + target map entries',
    },
    {
      id: 'WEB-03',
      title: 'Authentication and session behavior',
      owner: 'exploiter',
      tools: ['http_probe', 'nuclei_exec'],
      collect: ['login flow and token shape', 'session invalidation behavior', 'password reset / registration edges'],
      done: 'Auth boundaries are mapped and the first bypass hypothesis is recorded.',
      evidence: 'request/response pairs with identities',
    },
    {
      id: 'WEB-04',
      title: 'Injection and logic probes',
      owner: 'exploiter',
      tools: ['nuclei_exec', 'sqlmap_exec', 'http_probe', 'burst_probe'],
      collect: ['injection class per parameter', 'server-side behavior on malformed input', 'rate-limit posture (burst_probe once)'],
      done: 'Each hypothesis is PROVEN with two observations or killed with the killing observation recorded.',
      evidence: 'canary marker sent + echoed, with the exact request',
    },
    {
      id: 'WEB-05',
      title: 'Access control and object-level checks',
      owner: 'exploiter',
      tools: ['http_probe'],
      collect: ['object ownership checks', 'function-level auth', 'cross-role/tenant reads'],
      done: 'Every object/function boundary tested from the unauthorized identity, with the negative control.',
      evidence: 'authorized vs unauthorized pair',
    },
  ],
  forbidden: [
    'Destructive writes, deletes, or configuration changes on the target',
    'Credential stuffing or password spraying against real user accounts',
    'Data exfiltration beyond the single artifact that proves access',
  ],
  seatTasks: {
    coordinator: 'Bind family webapp, publish the step plan, open WEB-01 and name each transition by step id. Own scope and stop conditions.',
    recon: 'Own WEB-01 and WEB-02: fingerprint the stack, inventory every route and parameter, keep the shared target map current.',
    exploiter: 'Own WEB-03, WEB-04 and WEB-05: prove or kill every hypothesis with two observations and a negative control.',
    reporter: 'Convert only evidenced steps into findings; name each finding\'s endpoint shape, payload class and proof type.',
    coder: 'Build the payload, harness or parser a proving step needs, scoped to the mechanism under test.',
    publisher: 'Assemble the report and attestation; verify every claim traces to a recorded step and evidence bundle.',
  },
  skills: {
    coordinator: ['redteam-ops-coordination'],
    recon: ['deep-research-osint', 'webapp-scan'],
    exploiter: ['webapp-exploit', 'browser-action-execution'],
    reporter: ['findings-grading-reporting', 'html-report-design'],
    coder: ['exploit-coding-toolbuilding'],
    publisher: ['findings-grading-reporting', 'html-report-design'],
  },
}

/** Windows host (with optional AD). */
export const WINDOWS: TargetProtocol = {
  family: 'windows',
  label: 'Windows host / Active Directory',
  intelligence: [
    'Open TCP services and their versions (445/139/3389/5985/5986/88/389)',
    'Host role: workstation, member server, or domain controller',
    'Domain name, membership and reachable DCs',
    'SMB signing and NLA posture',
  ],
  confirm: 'SMB/WinRM/RDP listener answers, or WinRM SESSION_SETUP succeeds.',
  steps: [
    {
      id: 'WIN-01',
      title: 'Host and service discovery',
      owner: 'recon',
      // http_probe is discovery, not exploitation: a Windows host commonly runs a
      // web surface, and no other WIN step admits an HTTP tool at all.
      tools: ['nmap_exec', 'bridge_tcp_check', 'winrm_probe', 'http_probe'],
      collect: ['open ports + versions', 'OS family/version', 'SMB signing', 'WinRM auth schemes', 'RDP NLA', 'web banner, headers, TLS and admin-surface presence'],
      done: 'Services and posture are on the target map; host role is stated.',
      evidence: 'nmap XML-derived port/service list + probe output',
    },
    {
      id: 'WIN-02',
      title: 'Authentication reachability',
      owner: 'exploiter',
      tools: ['winrm_exec', 'smb_exec', 'rdp_auth', 'ssh_exec'],
      collect: ['which supplied credential works where', 'share exposure', 'remote execution reach'],
      done: 'Test-account access is proven or ruled out per service, with the failure observed.',
      evidence: 'successful command output + the denied parallel',
    },
    {
      id: 'WIN-03',
      title: 'Directory enumeration (AD present)',
      owner: 'recon',
      tools: ['ad_enum', 'smb_exec'],
      collect: ['users/groups/computers', 'ACLs granting non-Tier-0 principals', 'ADCS template conditions', 'computed attack paths'],
      done: 'Attack paths to Tier-0 are computed offline and recorded, or AD is proven absent.',
      evidence: 'enumeration output, paths as data (never executed)',
    },
    {
      id: 'WIN-04',
      title: 'Host enumeration through access',
      owner: 'exploiter',
      tools: ['winrm_exec', 'msf_exec'],
      collect: ['local privilege posture', 'services and unquoted paths', 'scheduled tasks', 'installed security controls'],
      done: 'Privilege-escalation hypotheses are listed with the evidence that scopes them.',
      evidence: 'command transcripts',
    },
    {
      id: 'WIN-05',
      title: 'Credential-material proof (authorized only)',
      owner: 'exploiter',
      tools: ['msf_exec'],
      collect: ['count/type of credential artifacts', 'proof artifact reference'],
      done: 'A single artifact proving the exposure is referenced; no bulk extraction retained.',
      evidence: 'sealed evidence reference + counts only',
    },
  ],
  forbidden: [
    'Domain-wide credential dumps retained or copied',
    'Usable credential modification, persistence, or account changes',
    'Real-user password spraying or lockout-triggering attempts',
  ],
  seatTasks: {
    coordinator: 'Bind family windows, publish the step plan, and refuse any host probe that is not in scope or not under a step id.',
    recon: 'Own WIN-01 and WIN-03: services/versions, host role, SMB signing, WinRM/RDP posture, then AD/ACL/ADCS enumeration with paths computed offline only.',
    exploiter: 'Own WIN-02, WIN-04 and WIN-05: prove which supplied credential reaches what, enumerate privilege posture through access, reference one credential artifact as proof.',
    reporter: 'Report host posture and reach with the exact command transcript; state plainly that computed paths were not executed.',
    coder: 'Build the execution or parsing helper a proving step needs; nothing that weakens the host or persists.',
    publisher: 'Assemble the report and attestation; cite ports, versions and transcripts as evidence, not impressions.',
  },
  skills: {
    coordinator: ['redteam-ops-coordination'],
    recon: ['scanning-network-with-nmap-advanced', 'performing-windows-artifact-analysis-with-eric-zimmerman-tools'],
    exploiter: ['performing-privilege-escalation-assessment', 'moving-laterally-with-netexec', 'performing-credential-access-with-lazagne'],
    reporter: ['findings-grading-reporting', 'html-report-design'],
    coder: ['exploit-coding-toolbuilding'],
    publisher: ['findings-grading-reporting', 'html-report-design'],
  },
}
