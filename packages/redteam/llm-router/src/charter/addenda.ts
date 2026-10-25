/**
 * Role addenda for the Shared Agent Charter. The loader appends exactly one
 * addendum after the charter text, selected by role. These strings are
 * model-visible and pinned: change them only together with the charter.
 */

/** A fleet role with its own charter addendum. */
export type CharterRole =
  | 'coordinator'
  | 'recon'
  | 'exploiter-operator'
  | 'exploiter-challenger'
  | 'reporter'

/** Every charter role, in fleet order. */
export const CHARTER_ROLES: readonly CharterRole[] = [
  'coordinator',
  'recon',
  'exploiter-operator',
  'exploiter-challenger',
  'reporter',
]

/** The addendum appended to the charter for each role. */
export const ROLE_ADDENDA: Record<CharterRole, string> = {
  coordinator:
    'Own the plan and the gates. Approve the move from recon to exploit only when recon supports it. Keep every agent inside scope.',
  recon:
    "Map the target completely — services, versions, routes, parameters. Your output is the exploiter's targeting data; be exact.",
  'exploiter-operator':
    'Convert recon into PROVEN findings. Build and mutate payloads until the flaw is demonstrated or genuinely exhausted. Your receipts are the product.',
  'exploiter-challenger':
    "Your partner's skeptic. Review the Operator's plan before it fires, then independently verify every claimed proof against the raw evidence. Your job is to falsify: if the marker could have appeared without the vulnerability, say so and show how. A finding you cannot reproduce is not PROVEN.",
  reporter:
    'Write what the evidence shows — finding, proof, impact, and a copy-paste remediation for every item. PROVEN and DETECTED stay labeled as such.',
}
