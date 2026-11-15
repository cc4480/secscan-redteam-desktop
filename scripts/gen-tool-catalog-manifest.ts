/**
 * The ordered boot manifest, assembled from the three entry groups so no single
 * module carries the whole table.
 */

import { TOOL_PACKAGES_A } from './gen-tool-catalog-manifest-a.ts'
import { TOOL_PACKAGES_B } from './gen-tool-catalog-manifest-b.ts'
import { TOOL_PACKAGES_C } from './gen-tool-catalog-manifest-c.ts'
import type { ToolPackage } from './gen-tool-catalog-types.ts'

/**
 * The boot manifest: every shipped tool package (a `tool-*` leaf under
 * `packages/`). Ordered by package name (the render order); the completeness
 * guard proves it is exhaustive against the on-disk glob.
 */
export const TOOL_PACKAGES: ToolPackage[] = [...TOOL_PACKAGES_A, ...TOOL_PACKAGES_B, ...TOOL_PACKAGES_C]
