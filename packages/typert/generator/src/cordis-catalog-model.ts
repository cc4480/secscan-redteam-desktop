/**
 * The vocabulary of the Cordis catalog projection: the entry records every
 * renderer consumes and the caller-supplied policy that classifies types and
 * inherited members.
 *
 * @module @deepseek-ai/dsh-typert-generator/cordis-catalog-model
 */

/** The dispatch mode an event declares in its `@mode` tag. */
export type Mode = 'emit' | 'bail' | 'waterfall' | 'parallel' | 'serial'

/** One harness event, extracted from an `interface Events` block. */
export interface EventEntry {
  /** Scoped name, e.g. `agent/request`. */
  name: string
  /** The scope prefix, e.g. `agent` (everything before the first `/`). */
  scope: string
  /** Full signature text (the method-signature member, JSDoc stripped). */
  signature: string
  /** Original declaration JSDoc, dedented from its containing interface. */
  jsDoc: string
  /** Dispatch mode from the `@mode` tag. */
  mode: Mode
  /** Description prose (JSDoc minus the `@mode` tag), one line per paragraph. */
  doc: string
  /** Source pointer `packages/…/file.ts:line` of the declaration. */
  source: string
}

/** One public service method and the source contract attached to it. */
export interface ServiceMethodEntry {
  /** Compiler member category; policy-supplied methods may omit it. */
  kind?: 'method' | 'property'
  /** Public method signature (body stripped). */
  signature: string
  /** Original method JSDoc, dedented from its containing class. */
  jsDoc: string
}

/** One harness service, extracted from an `interface Context` block. */
export interface ServiceEntry {
  /** The `ctx.<key>` name, e.g. `llm`. */
  key: string
  /** The service class/interface name, e.g. `LlmRuntime`. */
  type: string
  /** Whether the service class is abstract (a seam interface). */
  abstract: boolean
  /** Class-level JSDoc prose, one line per paragraph. */
  doc: string
  /** Public methods (bodies stripped), in source order. */
  methods: ServiceMethodEntry[]
  /** Source pointer of the class declaration. */
  source: string
}

/** A terse inherited-tier entry supplied by the catalog policy. */
export interface InheritedEntry {
  /** Display name of the inherited event or context member group. */
  name: string
  /** One-line description rendered into the catalog. */
  summary: string
  /** Source pointer such as `vendor/…:line`. */
  source: string
}

/** Repository policy consumed by the Cordis catalog parsing and rendering logic. */
export interface CordisCatalogPolicy {
  /** Type names linked from signatures to their documentation pages. */
  readonly linkedTypePages: Readonly<Record<string, string>>
  /** TypeScript or framework types that need no repository documentation link. */
  readonly foundationTypeNames: ReadonlySet<string>
  /** Repository types deliberately documented outside the linked data catalog. */
  readonly typeLinkExemptions: Readonly<Record<string, string>>
  /** Framework Services included in the model-facing runtime catalog but not the harness documentation partition. */
  readonly runtimeServices?: readonly ServiceEntry[]
  /** Harness Services omitted from the model-facing runtime catalog because dynamic Plugins must not call them. */
  readonly runtimeServiceExclusions?: ReadonlySet<string>
  /** Manually curated framework events inherited by every plugin. */
  readonly inheritedEvents: readonly InheritedEntry[]
  /** Manually curated framework context members inherited by every plugin. */
  readonly inheritedServices: readonly InheritedEntry[]
  /** Maximum rendered characters per runtime type declaration. */
  readonly runtimeDeclarationMaxChars?: number
}

/** Complete model-level Cordis projection used by every text renderer. */
export interface CordisCatalogModel {
  readonly events: readonly EventEntry[]
  readonly services: readonly ServiceEntry[]
}
