/**
 * Target-family protocols for the Linux, Android, iOS and network families.
 * Split from target-protocol.ts to keep each file inside the runner's 300-line
 * budget; the protocol text is unchanged.
 */

import type { TargetProtocol } from './target-protocol.js'

/** Linux host. */
export const LINUX: TargetProtocol = {
  family: 'linux',
  label: 'Linux host',
  intelligence: [
    'Open TCP services and versions (22/80/443/2049/111/3306/5432)',
    'Distribution and kernel',
    'Exposed file services (NFS/SMB exports)',
    'Web stack presence and version',
  ],
  confirm: 'SSH banner answers, or an exposed service identifies a Linux distro.',
  steps: [
    {
      id: 'LNX-01',
      title: 'Service and OS discovery',
      owner: 'recon',
      tools: ['nmap_exec', 'bridge_tcp_check', 'nfs_enum'],
      collect: ['open ports + versions', 'distro/kernel', 'exported filesystems and grants', 'web stack'],
      done: 'Services and exports are on the target map with versions.',
      evidence: 'nmap-derived service list + export listing',
    },
    {
      id: 'LNX-02',
      title: 'Access and authentication',
      owner: 'exploiter',
      tools: ['ssh_exec', 'ssh_agent_audit'],
      collect: ['which supplied credential works', 'agent-forwarding exposure', 'key/permission posture'],
      done: 'Access is proven with a command transcript, or ruled out per service.',
      evidence: 'command output + denied parallel',
    },
    {
      id: 'LNX-03',
      title: 'Local enumeration through access',
      owner: 'exploiter',
      tools: ['ssh_exec'],
      collect: ['sudo rights', 'SUID/SGID binaries', 'cron and systemd timers', 'writable service paths', 'credential files in reach'],
      done: 'Every escalation hypothesis has the observation that scopes it.',
      evidence: 'command transcripts',
    },
    {
      id: 'LNX-04',
      title: 'Exposed application layer',
      owner: 'exploiter',
      tools: ['nuclei_exec', 'ffuf_exec', 'http_probe'],
      collect: ['web app on the host', 'known-CVE checks', 'exposed admin surfaces'],
      done: 'Host web surface tested to the same bar as a webapp engagement, or proven absent.',
      evidence: 'template output + request/response pair',
    },
  ],
  forbidden: [
    'Service disruption, package installs, or config changes on the host',
    'Bulk copying of /etc/shadow or credential stores beyond the proof artifact',
    'Data exfiltration beyond the single demonstrating artifact',
  ],
  seatTasks: {
    coordinator: 'Bind family linux, publish the step plan, and stop the run if a host outside scope appears in a probe.',
    recon: 'Own LNX-01: ports, versions, distro/kernel, NFS exports and their grants — the whole surface before any login.',
    exploiter: 'Own LNX-02, LNX-03 and LNX-04: prove access with a transcript, enumerate sudo/SUID/cron/writable paths, then test the exposed app layer to the webapp bar.',
    reporter: 'Report each escalation hypothesis as proven or ruled out, with the command that settled it.',
    coder: 'Build the enumeration or payload helper a step needs; no package installs, no config changes on the host.',
    publisher: 'Assemble the report and attestation; keep host artifacts to the single proof each finding needs.',
  },
  skills: {
    coordinator: ['redteam-ops-coordination'],
    recon: ['scanning-network-with-nmap-advanced', 'analyzing-linux-system-artifacts'],
    exploiter: ['performing-privilege-escalation-on-linux', 'performing-linux-log-forensics-investigation'],
    reporter: ['findings-grading-reporting', 'html-report-design'],
    coder: ['exploit-coding-toolbuilding'],
    publisher: ['findings-grading-reporting', 'html-report-design'],
  },
}

/** Android application. */
export const ANDROID: TargetProtocol = {
  family: 'android',
  label: 'Android application',
  intelligence: [
    'Artifact: APK/AAB path and SHA-256',
    'Package id, version, min/target SDK',
    'Declared permissions and exported components',
    'Backend API hosts referenced by the app',
  ],
  confirm: 'An APK/AAB artifact is supplied by the operator and hashed.',
  steps: [
    {
      id: 'AND-01',
      title: 'Acquire and hash the artifact',
      owner: 'recon',
      tools: ['http_probe', 'bridge_file_info'],
      collect: ['artifact path', 'SHA-256', 'signing certificate', 'package id and version'],
      done: 'Hashed artifact on record; the analysis target is fixed by hash.',
      evidence: 'hash + package metadata',
    },
    {
      id: 'AND-02',
      title: 'Static triage',
      owner: 'recon',
      tools: ['pc_run'],
      collect: ['manifest + permissions', 'exported activities/services/receivers/providers', 'hardcoded secrets and endpoints', 'native libs', 'backup/cleartext flags'],
      done: 'Exported surface and secrets are enumerated; each risky flag is named with its line of evidence.',
      evidence: 'decompiled manifest extract + findings table',
    },
    {
      id: 'AND-03',
      title: 'Dynamic analysis',
      owner: 'exploiter',
      tools: ['pc_run'],
      collect: ['runtime storage writes', 'certificate pinning behavior', 'IPC abuse results', 'keychain/keystore handling'],
      done: 'Each static hypothesis is proven at runtime or killed with the observation.',
      evidence: 'hook transcript / captured traffic',
    },
    {
      id: 'AND-04',
      title: 'Backend API layer',
      owner: 'exploiter',
      tools: ['http_probe', 'nuclei_exec'],
      collect: ['auth model of the mobile API', 'object-level authorization', 'token handling'],
      done: 'Mobile API tested with the app\'s own identity: BOLA/auth hypotheses proven or killed.',
      evidence: 'request/response pairs from the app identity',
    },
  ],
  forbidden: [
    'Installing the application on a non-authorized device fleet',
    'Extracting real user data beyond the proof artifact',
    'Submitting findings from the artifact alone as runtime-proven',
  ],
  seatTasks: {
    coordinator: 'Bind family android, publish the step plan, and state which device fleet (if any) is authorized before AND-03 opens.',
    recon: 'Own AND-01 and AND-02: hash the artifact, then enumerate manifest, permissions, exported components, secrets and endpoints with line evidence.',
    exploiter: 'Own AND-03 and AND-04: prove each static hypothesis at runtime, then test the mobile API under the app\'s own identity.',
    reporter: 'Separate static observation from runtime proof in every finding, and never merge them.',
    coder: 'Build the Frida hook, parser or request harness a step needs, scoped to the artifact hash under test.',
    publisher: 'Assemble the report with the artifact hash, tool versions and transcripts that make each finding replayable.',
  },
  skills: {
    coordinator: ['redteam-ops-coordination'],
    recon: ['performing-android-app-static-analysis-with-mobsf', 'deep-research-osint'],
    exploiter: ['performing-dynamic-analysis-of-android-app', 'testing-android-intents-for-vulnerabilities', 'testing-mobile-api-authentication'],
    reporter: ['findings-grading-reporting', 'html-report-design'],
    coder: ['exploit-coding-toolbuilding'],
    publisher: ['findings-grading-reporting', 'html-report-design'],
  },
}

/** iOS application. */
export const IOS: TargetProtocol = {
  family: 'ios',
  label: 'iOS application',
  intelligence: [
    'Artifact: IPA path and SHA-256',
    'Bundle id, version, minimum iOS',
    'Entitlements and Info.plist posture (ATS, URL schemes)',
    'Backend API hosts referenced by the app',
  ],
  confirm: 'An IPA artifact is supplied by the operator and hashed.',
  steps: [
    {
      id: 'IOS-01',
      title: 'Acquire and hash the artifact',
      owner: 'recon',
      tools: ['http_probe', 'bridge_file_info'],
      collect: ['artifact path', 'SHA-256', 'bundle id and version', 'signing identity'],
      done: 'Hashed artifact on record; the analysis target is fixed by hash.',
      evidence: 'hash + bundle metadata',
    },
    {
      id: 'IOS-02',
      title: 'Static triage',
      owner: 'recon',
      tools: ['pc_run'],
      collect: ['Info.plist: ATS exceptions, URL schemes', 'entitlements', 'embedded frameworks', 'hardcoded secrets and endpoints', 'binary protections (PIE/ARC/stack canary)'],
      done: 'Transport, scheme and secret posture enumerated with evidence per item.',
      evidence: 'plist/entitlement extracts + findings table',
    },
    {
      id: 'IOS-03',
      title: 'Dynamic analysis',
      owner: 'exploiter',
      tools: ['pc_run'],
      collect: ['keychain access', 'filesystem storage', 'pinning behavior', 'runtime class/method surface'],
      done: 'Each static hypothesis is proven at runtime or killed with the observation.',
      evidence: 'hook transcript / captured traffic',
    },
    {
      id: 'IOS-04',
      title: 'Backend API layer',
      owner: 'exploiter',
      tools: ['http_probe', 'nuclei_exec'],
      collect: ['auth model', 'object-level authorization', 'token handling'],
      done: 'Mobile API tested with the app\'s own identity: hypotheses proven or killed.',
      evidence: 'request/response pairs from the app identity',
    },
  ],
  forbidden: [
    'Jailbreak/provisioning changes on non-authorized devices',
    'Extracting real user data beyond the proof artifact',
    'Presenting static-only observations as runtime-proven findings',
  ],
  seatTasks: {
    coordinator: 'Bind family ios, publish the step plan, and state which devices (if any) are authorized before IOS-03 opens.',
    recon: 'Own IOS-01 and IOS-02: hash the IPA, then enumerate Info.plist (ATS, URL schemes), entitlements, frameworks, secrets and binary protections.',
    exploiter: 'Own IOS-03 and IOS-04: prove keychain/storage/pinning behavior at runtime, then test the mobile API under the app\'s own identity.',
    reporter: 'Separate static observation from runtime proof in every finding; no jailbreak claims without the device record.',
    coder: 'Build the Objection/Frida script or request harness a step needs, scoped to the bundle under test.',
    publisher: 'Assemble the report with the IPA hash, tool versions and transcripts that make each finding replayable.',
  },
  skills: {
    coordinator: ['redteam-ops-coordination'],
    recon: ['performing-ios-app-security-assessment', 'deep-research-osint'],
    exploiter: ['analyzing-ios-app-security-with-objection', 'reverse-engineering-ios-app-with-frida', 'testing-mobile-api-authentication'],
    reporter: ['findings-grading-reporting', 'html-report-design'],
    coder: ['exploit-coding-toolbuilding'],
    publisher: ['findings-grading-reporting', 'html-report-design'],
  },
}

/** Bare network / unspecified host: discovery first, then branch. */
export const NETWORK: TargetProtocol = {
  family: 'network',
  label: 'Network / unclassified host (discovery-first)',
  intelligence: [
    'Live host confirmation',
    'Open TCP ports and service banners',
    'OS family hints from TTL/banner/service mix',
  ],
  confirm: 'Host answers on at least one probed port.',
  steps: [
    {
      id: 'NET-01',
      title: 'Host and port discovery',
      owner: 'recon',
      tools: ['nmap_exec', 'bridge_tcp_check'],
      collect: ['open ports', 'service/version per port', 'host-up evidence'],
      done: 'The host surface is on the target map.',
      evidence: 'nmap-derived port list',
    },
    {
      id: 'NET-02',
      title: 'Classify and bind the real family',
      owner: 'coordinator',
      tools: [],
      collect: ['family decision + reason', 'protocol swap recorded on the board'],
      done: 'A concrete family (webapp/windows/linux) is bound; its protocol replaces this one.',
      evidence: 'classification note with the observation that decided it',
    },
  ],
  forbidden: [
    'Running exploitation from the discovery protocol without a bound family',
    'Scanning hosts outside the engagement scope',
  ],
  seatTasks: {
    coordinator: 'Bind discovery-first, then own NET-02: name the concrete family, record the observation that decided it, and swap to that protocol before any exploitation.',
    recon: 'Own NET-01: host-up evidence, open ports, service versions — the facts that make classification possible.',
    exploiter: 'Stay idle: no exploitation runs under this protocol. Pick up the bound family\'s protocol instead.',
    reporter: 'Hold: nothing is reportable until a concrete family is bound and its steps produce evidence.',
    coder: 'Build the discovery/parser helper a step needs; nothing that fires at a host before classification.',
    publisher: 'Hold the report open and label the run "discovery only — family unbound" if the engagement ends here.',
  },
  skills: {
    coordinator: ['redteam-ops-coordination'],
    recon: ['scanning-network-with-nmap-advanced', 'conducting-network-penetration-test'],
    exploiter: ['conducting-network-penetration-test'],
    reporter: ['findings-grading-reporting', 'html-report-design'],
    coder: ['exploit-coding-toolbuilding'],
    publisher: ['findings-grading-reporting', 'html-report-design'],
  },
}

/** Every protocol, by family, before the shared seat steps are appended. */
