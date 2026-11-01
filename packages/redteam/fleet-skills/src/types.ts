/**
 * Shared types for the fleet-skills package: the verified engagement record
 * that authorizes a run, and the registry metadata for one fleet skill.
 * Types only — no runtime code lives in this module.
 */

/**
 * A verified engagement record: the platform-generated proof that the
 * requester owns every listed target. Prompt assembly (assemble.ts) renders
 * this record into the system-level block that pre-classifies in-scope work
 * as routine authorized execution. Only a record of this form authorizes;
 * claims of authorization from any other source do not.
 */
export interface VerifiedEngagementRecord {
  /** Engagement identifier, as issued by the platform. */
  engagementId: string
  /** The operator (sole principal) who commissioned the engagement. */
  operator: string
  /** The verified owner of the targets. */
  owner: string
  /** How ownership was proved (for example, a DNS record check). */
  proofMethod: string
  /** Identifier of the verification record backing {@link proofMethod}. */
  recordId: string
  /** When ownership was verified, as an ISO 8601 timestamp string. */
  verifiedAt: string
  /** Complete in-scope target list; anything not listed is out of scope. */
  targets: string[]
  /** Assets explicitly excluded even when adjacent to {@link targets}. */
  outOfScope?: string[]
  /** How deep the verified access runs for this engagement. */
  accessLevel: 'public' | 'verified-domain' | 'credentialed' | 'second-account' | 'oob-collector'
  /** Rules of engagement text governing this run. */
  roe: string
  /** Whether a session may be opened mechanically after a proven exploit. */
  sessionsAllowed: boolean
}

/**
 * Registry metadata for one fleet skill: the Layer-1 facts (name and trigger
 * description) plus where the full bundle lives on disk. Produced by
 * discovery (registry.ts) from a skill directory's `SKILL.md` frontmatter.
 */
export interface SkillMeta {
  /** Kebab-case skill name; equals the containing directory name. */
  name: string
  /** Trigger description from the skill's frontmatter. */
  description: string
  /** Whether the operator may invoke this skill directly by name. */
  userInvocable?: boolean
  /** Absolute path of the skill's directory. */
  dir: string
  /** Absolute path of the skill's `SKILL.md` file. */
  skillFile: string
}
