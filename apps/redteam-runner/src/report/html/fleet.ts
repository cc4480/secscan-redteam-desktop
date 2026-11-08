/**
 * The standing fleet roster the report's team section renders — extracted
 * from wire.ts to keep the wiring module under the 300-line budget.
 */
import { type TeamMember } from './sections.js'

/** The fleet roster as the report's team section states it: every
 * seat, its role on the engagement. Summaries stay with the record —
 * the wire carries the standing roles only. */
export const FLEET_TEAM: TeamMember[] = [
  { agent: 'Morpheus', seat: 'Lead Coordinator', role: 'Owns the engagement: the plan, the scope and authorisation gates, fleet sequencing, and final adjudication of what counts as proven.' },
  { agent: 'Tank', seat: 'Reconnaissance', role: 'Maps the target surface — hosts, services, endpoints, and exposure — and keeps the inventory the plan runs against.' },
  { agent: 'Neo', seat: 'Exploitation', role: 'Executes the authorised attack paths and produces the execution evidence behind every proven finding.' },
  { agent: 'Agent Smith', seat: 'Contradiction & Review', role: 'The fleet nemesis: contradicts every claim the other seats make, challenges their evidence line by line, and catches where they messed up. Nothing counts as proven until it survives his review.' },
  { agent: 'Trinity', seat: 'Reporting & Deliverables', role: 'Assembles this report and the full deliverable set from the verified engagement record.' },
]
