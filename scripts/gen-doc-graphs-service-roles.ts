/**
 * The service-role classification table behind the capability-seams graph,
 * assembled from its data slices, plus the completeness guard that keeps the
 * table in step with the services discovered from Cordis declarations.
 */

import type { ServiceEntry } from '@deepseek-ai/dsh-typert-generator'
import type { ServiceRole } from './gen-doc-graphs-shared.ts'
import { SERVICE_ROLES_PART_1 } from './gen-doc-graphs-service-roles-part1.ts'
import { SERVICE_ROLES_PART_2 } from './gen-doc-graphs-service-roles-part2.ts'
import { SERVICE_ROLES_PART_3 } from './gen-doc-graphs-service-roles-part3.ts'
import { SERVICE_ROLES_PART_4 } from './gen-doc-graphs-service-roles-part4.ts'

/** Every service role classification, in the order the graph presents them. */
export const SERVICE_ROLES: ServiceRole[] = [
  ...SERVICE_ROLES_PART_1,
  ...SERVICE_ROLES_PART_2,
  ...SERVICE_ROLES_PART_3,
  ...SERVICE_ROLES_PART_4,
]

/** Throw when the classification table and the discovered services disagree. */
export function assertServiceRolesComplete(services: readonly ServiceEntry[]): void {
  const discovered = new Set(services.map(service => service.key))
  const classified = new Set(SERVICE_ROLES.map(role => role.key))
  const missing = [...discovered].filter(key => !classified.has(key)).sort()
  const stale = [...classified].filter(key => !discovered.has(key)).sort()
  if (missing.length || stale.length) {
    throw new Error([
      missing.length ? `missing service role classification: ${missing.join(', ')}` : '',
      stale.length ? `stale service role classification: ${stale.join(', ')}` : '',
    ].filter(Boolean).join('; '))
  }
}
