/**
 * Repository root and the data model the documentation graph generator shares
 * across its rendering modules: graph documents, service roles, parsed example
 * plugins, event relations, and the scanned package sources.
 */

import { resolve } from 'node:path'
import type { SourceFile } from 'typescript'
import type { PackageGraphNode } from './package-graph.ts'

/** Repository root, one directory above this script. */
export const root = resolve(import.meta.dirname, '..')

/** One package in the module dependency graph. */
export type Pkg = PackageGraphNode

/** One rendered graph document: its repository-relative path and content. */
export interface GraphDoc {
  rel: string
  content: string
}

/** How one ctx service is classified in the capability-seams graph. */
export interface ServiceRole {
  key: string
  pkg: string
  title: string
  mode: 'core' | 'seam' | 'bundle' | 'service'
  implementations?: string[]
  consumers?: string[]
  companions?: string[]
  note: string
}

/** One plugin row parsed out of a composition's cordis patch. */
export interface ExamplePlugin {
  id: string
  name: string
}

/** Dispatchers and listeners collected for one event name. */
export interface EventRelation {
  dispatchers: Map<string, Set<string>>
  listeners: Set<string>
}

/** One scanned package source file and its owning package short name. */
export interface PackageSource {
  /** Repository-relative path. */
  rel: string
  /** Package short name from the `packages/<group>/<pkg>/src` path. */
  pkg: string
  /** The bound program source file. */
  sourceFile: SourceFile
}

/** Which event API a call receiver was classified through. */
export type EventReceiverKind = 'context' | 'agent-dispatch' | 'events-service'

/** Group directory order the module dependency graph presents its packages in. */
export const GROUP_ORDER = [
  'util',
  'attachment',
  'document',
  'llm',
  'core',
  'typert',
  'goal',
  'experimental',
  'process',
  'bash',
  'pty',
  'sandbox',
  'ssh',
  'fs',
  'skill',
  'compact',
  'subagent',
  'tasks',
  'workflow',
  'web',
  'webhook',
  'spill',
  'todo',
  'plan',
  'cordis',
  'hooks',
  'session-persistence',
  'session-query',
  'session-title',
  'telemetry',
  'storage',
  'workspace',
  'support',
  'acp',
  'ui',
]
