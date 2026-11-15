/**
 * Catalog vocabulary shared by the boot manifest, the harvest and the renderer:
 * one manifest entry per tool package and the harvested catalog that comes out
 * of booting them.
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import type { Config as ToolsConfig } from '@deepseek-ai/dsh-tools'

/**
 * Tool package plus its hand-maintained boot recipe. The caller mounts the
 * prompt and registry; each recipe supplies only package-specific seams and
 * config, while `dir` participates in the completeness check.
 */
export interface ToolPackage {
  /** The npm package name, used as the catalog section heading. */
  pkg: string
  /** The `packages/<group>/<dir>` leaf name — matched by the completeness guard. */
  dir: string
  /**
   * Repo-relative implementation source linked per harvested tool. Packages
   * whose tools share one plugin may use a string; split plugins map each tool
   * name to its own source.
   */
  source: string | Readonly<Record<string, string>>
  /** Services or owning runtimes the package requires at execution time. */
  requires: string[]
  /** Session events or other visible state the tools write or affect. */
  writes: string[]
  /** Additional model-visible names shipped by example/app config. */
  shippedNames?: string[]
  /** Plug the injected seams + the tool plugin onto a context that already
   * carries `systemPrompt` + `tools`. */
  mount: (ctx: Context) => Promise<void>
  /** Agent-like scope key whose tool view is catalogued instead of the global view. */
  scope?: (ctx: Context) => Agent
  /**
   * Config for the caller's `ToolRuntime` mount. The registry itself ships a
   * model-facing tool (`run_code`, registered under a non-native `mode`), so
   * ITS catalog entry boots the registry in the mode that exposes it;
   * every other entry uses the default (native) registry.
   */
  toolsConfig?: ToolsConfig
  /**
   * A deployment note rendered after the package's tools, for a fact that
   * booting the package alone cannot show. The registered tool NAME can be a
   * load-time config (`tool-subagent`'s `toolName`), so one package may appear
   * under several names across deployments — the boot yields the package
   * DEFAULT, and this note records the shipped alternatives the model sees.
   */
  note?: string
}

/** One package's contribution to the catalog: its schemas plus attribution. */
export interface CatalogPackage {
  pkg: string
  sources: Readonly<Record<string, string>>
  requires: string[]
  writes: string[]
  shippedNames?: string[]
  schemas: ToolSchema[]
  /** A deployment note (see {@link ToolPackage.note}), rendered after the tools. */
  note?: string
}

/** The whole catalog: one entry per booted tool package, in manifest order. */
export type ToolCatalog = CatalogPackage[]
