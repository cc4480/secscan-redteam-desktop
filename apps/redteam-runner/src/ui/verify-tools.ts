/**
 * Fleet-facing domain-ownership tools.
 *
 * The engagement fleet can only be trusted to test what it proved it owns, and
 * proving it is a DNS challenge this app issues itself — so the fleet needs the
 * two calls that drive that challenge, `verify_domain_start` and
 * `verify_domain_check`, plus the read-only `verify_domain_list`. Without them
 * the operator has to leave the chat to authorize a target, which in practice
 * means the chat runs unverified.
 *
 * Nothing here consults an external service. `start` mints a token and records
 * it locally; `check` reads the operator's TXT record through the system
 * resolver and records the domain as verified on a match. Both fail closed.
 *
 * These are the ONLY tools in this package that reach the verifier, so the
 * authority they add is exactly "prove ownership", never "assert ownership".
 */

import { LocalDomainVerifier, defaultVerificationStoreFile, VerificationStore } from '@secscan/redteam-auth-gate'
import type { Captured, ToolDef } from './mcp-tools.js'

const str = (d: string): Record<string, unknown> => ({ type: 'string', description: d })

/** One verifier per call, so the store path is read from the environment each time. */
function verifier(): LocalDomainVerifier {
  return LocalDomainVerifier.create()
}

/** The verified-domain store, for the read-only list tool. */
function store(): VerificationStore {
  return new VerificationStore(defaultVerificationStoreFile())
}

function failure(err: unknown): Captured {
  return {
    status: 400,
    body: { ok: false, error: err instanceof Error ? err.message : String(err) },
  }
}

/**
 * The three ownership tools, in the shape the console's MCP endpoint serves.
 * @returns tool definitions registered alongside the cockpit and engagement tools.
 */
export const VERIFY_TOOLS: ToolDef[] = [
  {
    name: 'verify_domain_start',
    description:
      'Issue a DNS ownership challenge for a domain. Returns the TXT record name and the exact token '
      + 'to publish; nothing is authorized until verify_domain_check confirms the record. No external '
      + 'service is contacted.',
    inputSchema: {
      type: 'object',
      properties: { domain: str('Domain or URL to prove ownership of, e.g. acme.example or https://acme.example') },
      required: ['domain'],
      additionalProperties: false,
    },
    run: async (_store, a) => {
      try {
        return { status: 200, body: { ok: true, challenge: await verifier().startVerification(String(a['domain'])) } }
      } catch (err) {
        return failure(err)
      }
    },
  },
  {
    name: 'verify_domain_check',
    description:
      'Read the operator\'s DNS TXT record for a domain and record it as ownership-verified when the token '
      + 'matches. Fails closed: a missing, unreadable or wrong record is a denial with the reason.',
    inputSchema: {
      type: 'object',
      properties: { domain: str('Domain to check against the token issued by verify_domain_start') },
      required: ['domain'],
      additionalProperties: false,
    },
    run: async (_store, a) => {
      try {
        const verified = await verifier().checkVerification(String(a['domain']))
        return { status: verified ? 200 : 400, body: { ok: verified, verified } }
      } catch (err) {
        return failure(err)
      }
    },
  },
  {
    name: 'verify_domain_list',
    description: 'List the domains this app currently records as ownership-verified.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => {
      try {
        const s = store()
        const doc = await s.load()
        return { status: 200, body: { ok: true, store: s.path, domains: Object.keys(doc.verified) } }
      } catch (err) {
        return failure(err)
      }
    },
  },
]
