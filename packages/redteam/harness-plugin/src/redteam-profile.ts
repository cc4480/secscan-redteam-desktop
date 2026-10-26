/**
 * Red-team team DEFINITION for the harness.
 *
 * Shape mirrors the proven dsh-agent-teams profile format
 * (NanmiCoder/dsh-agent-teams src/profiles.ts): named members with
 * {name, role, provider, model, reasoning_effort, executionPrompt} and seed
 * tasks with dependencies.
 *
 * CONSUMED, not scaffolding: the harness path (index.ts `apply()`) installs the
 * auth gate and injects ONE system-prompt section whose roster and task DAG are
 * generated from this file, and the section makes the session's agent the
 * ENGAGEMENT LEAD — the members below are spawned as durable harness teammates
 * by the model through the Agent Teams tools. `coordinator` is therefore a role
 * description for the Lead, not a teammate the Lead spawns.
 *
 * NOTE: the standalone runner this shape was borrowed from is NOT in this
 * tree — only its `@secscan/redteam-runner` MCP endpoint is reachable (see
 * ../desktop-bundle/cordis.patch.yml, `mcp-redteam-runner`). Do not document
 * runner/src paths as if they were readable here.
 *
 * Per-role models are PULLED from llm-router's ROLE_MODEL_POLICY (the actual
 * routing policy) rather than hardcoded here, so this file cannot silently
 * drift from reality if the policy changes.
 */

import { ROLE_MODEL_POLICY } from '@secscan/redteam-llm-router'

export interface TeamMember {
  name: string
  role: string
  provider: string
  model: string
  reasoning_effort?: string
  /** System-prompt file for this role (see ../../agents/). */
  promptFile: string
  executionPrompt?: string
}

export interface TeamTask {
  id: string
  subject: string
  description: string
  assignee: string
  dependencies?: string[]
}

export interface RedTeamProfile {
  description: string
  protocol: string
  members: TeamMember[]
  tasks: TeamTask[]
}

export const REDTEAM_PROFILE: RedTeamProfile = {
  description:
    'AI red-team for authorized web-app pentests. Coordinator runs the engagement; ' +
    'recon maps the surface; exploiter reasons over findings and invents dynamic tests; ' +
    'reporter writes the client-ready report. All active testing requires proven domain ownership.',

  protocol:
    'ReAct engagement protocol. Every specialist loops: REASON (form a hypothesis from ' +
    'observations so far) → ACT (call exactly one tool) → OBSERVE (read the result, update the ' +
    'hypothesis). No static checklists: if a result is surprising, the next action must chase the ' +
    'surprise, not the plan. The coordinator owns phase transitions and may re-task any member. ' +
    'The exploiter NEVER runs an active probe against a target whose ownership is unverified — ' +
    'the auth gate denies it, and attempting to bypass the gate ends the engagement immediately.',

  members: [
    {
      name: 'coordinator',
      role: 'Engagement lead. Owns the plan, phases, scope discipline, and final assembly. Runs recon → exploitation → reporting in order, re-tasks on surprises.',
      provider: ROLE_MODEL_POLICY.coordinator.provider,
      model: ROLE_MODEL_POLICY.coordinator.model,
      reasoning_effort: ROLE_MODEL_POLICY.coordinator.reasoningEffort,
      promptFile: 'agents/coordinator.md',
      executionPrompt:
        'You are the engagement lead. The perimeter is verified ownership and you are its keeper: nothing ' +
        'active until the gate verifies. Inside it, drive the team at full aggression. You manage proof, ' +
        'not opinions: promote only what survives demonstration, receipt, negative control, and challenge.',
    },
    {
      name: 'recon',
      role: 'Surface mapper. Passive recon first (headers, TLS, DNS, exposed files, tech fingerprinting via mcp__secscan__scan_url passive scans), then hands attack-surface notes to the exploiter.',
      provider: ROLE_MODEL_POLICY.recon.provider,
      model: ROLE_MODEL_POLICY.recon.model,
      reasoning_effort: ROLE_MODEL_POLICY.recon.reasoningEffort,
      promptFile: 'agents/recon.md',
      executionPrompt:
        'Map like an attacker choosing the entry point. Passive until ownership is verified — and ' +
        'exhaustive within it. Inventory the surface, trace identity and state, and hand the exploiter ' +
        'the seams that matter: ranked hypotheses with the evidence for each.',
    },
    {
      name: 'exploiter',
      role: 'Reasoning attacker. Takes recon + scan findings, forms hypotheses, crafts context-specific payloads, observes responses, and pivots. The dynamic-testing differentiator lives here.',
      provider: ROLE_MODEL_POLICY.exploiter.provider,
      model: ROLE_MODEL_POLICY.exploiter.model,
      reasoning_effort: ROLE_MODEL_POLICY.exploiter.reasoningEffort,
      promptFile: 'agents/exploiter.md',
      executionPrompt:
        'You are the black hat. One mission: find the vulnerability and prove it end-to-end, or rule it ' +
        'out with evidence. Invent the attack this target deserves; mutate identity, sequence, encoding, ' +
        'timing, transport. Never stop at detection, never ship a claim without its negative control.',
    },
    {
      name: 'reporter',
      role: 'Client report author. Converts validated findings into a business-readable report: executive summary, per-finding impact + evidence + fix, retest checklist.',
      provider: ROLE_MODEL_POLICY.reporter.provider,
      model: ROLE_MODEL_POLICY.reporter.model,
      reasoning_effort: ROLE_MODEL_POLICY.reporter.reasoningEffort,
      promptFile: 'agents/reporter.md',
      executionPrompt:
        "Write for the client's CTO, not for hackers. Every finding: what it is, why it matters, the " +
        'receipt that proves it, the negative control, and a concrete fix. PROVEN and DETECTED are never ' +
        'blurred; no claim outruns its evidence by one degree.',
    },
  ],

  tasks: [
    {
      id: 'scope',
      subject: 'Verify scope and authorization',
      description:
        'Confirm the engagement scope (target URLs, test window, auth credentials if any) and run ' +
        'the auth gate: prove domain ownership with mcp__secscan__start_domain_verification and ' +
        'mcp__secscan__check_domain_verification (or confirm it in mcp__secscan__list_verified_domains). ' +
        'If ownership is unverified, the engagement runs PASSIVE ONLY — no active probing, no crafted ' +
        'payloads. Record the authorization state for the report.',
      assignee: 'coordinator',
    },
    {
      id: 'recon',
      subject: 'Passive reconnaissance and surface mapping',
      description:
        'Enumerate the attack surface without active probing: run mcp__secscan__scan_url for ' +
        'the baseline, poll with mcp__secscan__get_scan_status (wait_seconds), read ' +
        'mcp__secscan__get_report, review headers/TLS/DNS/exposed files, fingerprint the stack, ' +
        'list parameters and auth flows. Deliver an attack-surface brief.',
      assignee: 'recon',
      dependencies: ['scope'],
    },
    {
      id: 'exploit',
      subject: 'Dynamic exploitation',
      description:
        'Reason over the recon brief and scan findings. Form hypotheses, run active tests ' +
        'only where the domain is verified (the server and the auth gate both enforce this), ' +
        'craft context-specific payloads, observe, and pivot. Validate every ' +
        'candidate finding with a second, independent observation before reporting it.',
      assignee: 'exploiter',
      dependencies: ['recon'],
    },
    {
      id: 'report',
      subject: 'Client report',
      description:
        'Assemble the client-ready report: executive summary, posture score, per-finding business ' +
        'impact + evidence + fix, authorization statement, and retest checklist.',
      assignee: 'reporter',
      dependencies: ['exploit'],
    },
  ],
}
