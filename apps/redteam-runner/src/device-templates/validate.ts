/**
 * Device-template validation — the mechanical form of "every device uses its
 * whole toolset".
 *
 * Pure: takes the catalogue and the templates, returns the violations. The
 * runner's test suite calls it with the real constants; nothing here touches
 * the network or the model, so a gap fails the build rather than surfacing as
 * a scan that quietly skipped half its capability.
 */
import {
  DEVICE_ORDER,
  TOOL_CATALOGUE,
  type DeviceId,
  type DeviceTemplate,
  type ScanPhase,
} from './catalog.js'
import { DEVICE_RULES } from './roe.js'

export interface Violation {
  rule: string
  detail: string
}

const REQUIRED_PHASES: readonly ScanPhase[] = ['recon', 'exploit', 'report']

/**
 * Validate a template set against the catalogue.
 *
 * @param templates - device id → template
 * @param catalogue - every tool the product exposes
 * @returns every violation found, empty when the set is sound
 */
export function validateDeviceTemplates(
  templates: Record<DeviceId, DeviceTemplate>,
  catalogue: readonly { name: string }[] = TOOL_CATALOGUE,
): Violation[] {
  const violations: Violation[] = []
  const known = new Set(catalogue.map(t => t.name))
  const usedBy = new Map<string, string[]>()

  for (const id of DEVICE_ORDER) {
    const template = templates[id]
    if (template === undefined) {
      violations.push({ rule: 'template-missing', detail: `no template for device "${id}"` })
      continue
    }
    if (template.id !== id) {
      violations.push({ rule: 'template-id-mismatch', detail: `key "${id}" holds template "${template.id}"` })
    }
    if (template.tools.length === 0) {
      violations.push({ rule: 'template-empty', detail: `device "${id}" declares no tools` })
    }
    if (template.evidence.length === 0) {
      violations.push({ rule: 'no-evidence-bar', detail: `device "${id}" declares no evidence requirement` })
    }

    const seen = new Set<string>()
    for (const tool of template.tools) {
      if (!known.has(tool)) {
        violations.push({ rule: 'unknown-tool', detail: `device "${id}" lists "${tool}", which is not in the catalogue` })
      }
      if (seen.has(tool)) {
        violations.push({ rule: 'duplicate-tool', detail: `device "${id}" lists "${tool}" twice` })
      }
      seen.add(tool)
      usedBy.set(tool, [...(usedBy.get(tool) ?? []), id])
    }

    for (const phase of REQUIRED_PHASES) {
      if (!template.phases.includes(phase)) {
        violations.push({ rule: 'phase-missing', detail: `device "${id}" does not run the "${phase}" phase` })
      }
    }
  }

  // The headline rule: no tool may be orphaned. A capability that no device
  // template claims is a capability the fleet never uses.
  for (const tool of known) {
    if (!usedBy.has(tool)) {
      violations.push({ rule: 'orphan-tool', detail: `"${tool}" is in the catalogue but no device template uses it` })
    }
  }

  // Every device class carries its own rules of engagement, and those rules must
  // leave the work possible: a template whose rules forbade exploitation would ship
  // a scanner too timid to prove anything on that device.
  for (const id of DEVICE_ORDER) {
    const rules = DEVICE_RULES[id]
    if (!rules) {
      violations.push({ rule: 'missing-device-rules', detail: `device "${id}" has no rules of engagement` })
      continue
    }
    if (rules.aggression.length === 0 || rules.proof.length === 0 || rules.limits.length === 0) {
      violations.push({ rule: 'incomplete-device-rules', detail: `device "${id}" must state aggression, proof and limits` })
    }
  }
  return violations
}
