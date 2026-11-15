/**
 * The Cordis catalog projector: validate one analyzed face's Services and
 * events against the caller's policy and project them into the catalog model.
 *
 * @module @deepseek-ai/dsh-typert-generator/cordis-catalog-projector
 */

import { TypeGraphRenderer } from './renderer.ts'
import type { FaceModel, ServiceModel, SourceDeclarationModel } from './model.ts'
import type { CordisCatalogModel, CordisCatalogPolicy, EventEntry, ServiceEntry, ServiceMethodEntry } from './cordis-catalog-model.ts'
import { checkParams, checkReturns, isMode, parseJsDoc, pointer, reportViolations } from './cordis-catalog-jsdoc.ts'
import { checkTypeLinks, reportTypeLinkViolations, signatureTypeNames } from './cordis-catalog-type-links.ts'
import { DEFAULT_MAX_DECL_CHARS, referencedTypes } from './cordis-catalog-declarations.ts'
import { renderRuntimeApi } from './cordis-catalog-runtime.ts'

/** Repository-specific Cordis validation and projection over one Typert face. */
export class CordisCatalogProjector {
  private readonly renderer: TypeGraphRenderer

  /**
   * @param face - analyzed Host or Client face containing package business semantics.
   * @param sourceDeclarations - exported declarations available to the runtime type closure.
   * @param policy - caller-owned type classifications and inherited Cordis data.
   */
  constructor(
    private readonly face: FaceModel,
    private readonly sourceDeclarations: readonly SourceDeclarationModel[],
    private readonly policy: CordisCatalogPolicy,
  ) {
    this.renderer = new TypeGraphRenderer(face.graph)
  }

  /**
   * Validate and project the host model's Cordis API.
   * @returns every validated service and event projected from the host model.
   */
  project(): CordisCatalogModel {
    return {
      events: this.collectEvents(),
      services: this.collectServices(),
    }
  }

  /**
   * Render the model-facing static API consumed by `tool-cordis`.
   * @param model - validated Cordis catalog projection from this projector.
   * @returns the model-facing TypeScript catalog source.
   */
  renderRuntimeApi(model: CordisCatalogModel): string {
    const services = [...model.services, ...(this.policy.runtimeServices ?? [])]
      .filter(service => !this.policy.runtimeServiceExclusions?.has(service.key))
      .sort((left, right) => left.key.localeCompare(right.key))
    return renderRuntimeApi(
      services,
      model.events,
      this.runtimeTypes(services, model.events),
      this.policy.inheritedServices,
    )
  }

  private collectEvents(): EventEntry[] {
    const entries: EventEntry[] = []
    const violations: string[] = []
    const typeLinkViolations: string[] = []
    for (const packageModel of this.face.packages) {
      for (const event of packageModel.events) {
        const parsed = parseJsDoc(event.jsDoc ?? '')
        if (parsed.deprecated) continue
        const source = pointer(event.location)
        const where = `event '${event.name}' (${source})`
        const node = this.renderer.node(event.signature)
        if (node.kind !== 'function') {
          violations.push(`${where} is not represented by a callable type.`)
          continue
        }
        if (this.face.face === 'host') {
          checkTypeLinks(where, signatureTypeNames(this.renderer, node.signature), this.policy, typeLinkViolations)
        }
        const mode = event.mode
        if (!isMode(mode)) {
          violations.push(`${where} is missing an @mode tag. Add '@mode emit|bail|waterfall|parallel|serial' to its JSDoc (see AGENTS.md).`)
        }
        const last = node.signature.parameters.at(-1)
        const hasNext = last?.name === 'next'
        if (isMode(mode) && hasNext && mode !== 'waterfall') {
          violations.push(`${where} has a trailing 'next' parameter (structurally a waterfall) but is tagged '@mode ${mode}'. Fix the tag or the signature.`)
        }
        if (isMode(mode) && !hasNext && mode === 'waterfall') {
          violations.push(`${where} is tagged '@mode waterfall' but has no trailing 'next' parameter. A waterfall delegates via next().`)
        }
        if (parsed.doc === '') {
          violations.push(`${where} has no description prose. Say what happened / what a listener may do, above the block tags.`)
        }
        checkParams(
          where,
          'event',
          node.signature.parameters,
          parsed.params,
          parameter => parameter.receiver || (hasNext && parameter === last),
          violations,
        )
        if (isMode(mode)) {
          entries.push({
            name: event.name,
            scope: event.name.split('/')[0] ?? event.name,
            signature: event.text,
            jsDoc: event.jsDoc ?? '',
            mode,
            doc: parsed.doc,
            source,
          })
        }
      }
    }
    reportViolations('gen-cordis-catalog', violations)
    reportTypeLinkViolations('gen-cordis-catalog', typeLinkViolations)
    return entries
  }

  /**
   * The services this projection describes, one per `ctx.<key>`: those whose
   * Context merge sits one level under a package's `src` and whose declaration
   * belongs to that same package.
   *
   * Interfaces qualify beside classes, because an interface-typed key
   * (`lsp: LspService`) has its Service Definition — and, by repository
   * convention, its member documentation — on the interface; requiring a class
   * would drop a real injectable service from every catalog. The declaration may
   * live in any file of the package (`types.ts` is the usual home), while a
   * declaration from ANOTHER package is not this package's surface to document.
   *
   * One key can have both kinds of candidate across packages: `ctx.typert` is
   * typed by a merge-extensible interface in `type-meta` and implemented by a
   * class in `registry`. The CLASS wins — it carries the documentation and is the
   * object a caller meets — and picking before validating is what keeps a
   * discarded candidate's missing JSDoc from failing the gate.
   */
  private renderableServices(): ServiceModel[] {
    const chosen = new Map<string, ServiceModel>()
    for (const packageModel of this.face.packages) {
      for (const service of packageModel.services) {
        const declaration = this.renderer.declaration(service.symbol)
        const owner = /^packages\/[^/]+\/[^/]+\/src\//.exec(service.location.file)?.[0]
        if ((declaration.kind !== 'class' && declaration.kind !== 'interface')
          || owner === undefined
          || (this.face.face === 'host'
            ? !/^packages\/[^/]+\/[^/]+\/src\/[^/]+\.ts$/.test(service.location.file)
            : !/^packages\/[^/]+\/[^/]+\/src\/client\/.+\.tsx?$/.test(service.location.file))
          || !declaration.location.file.startsWith(owner)) continue
        const current = chosen.get(service.key)
        if (current !== undefined && this.renderer.declaration(current.symbol).kind === 'class') continue
        chosen.set(service.key, service)
      }
    }
    return [...chosen.values()]
  }

  private collectServices(): ServiceEntry[] {
    const entries: ServiceEntry[] = []
    const violations: string[] = []
    const typeLinkViolations: string[] = []
    for (const service of this.renderableServices()) {
      const declaration = this.renderer.declaration(service.symbol)
      const parsedDeclaration = parseJsDoc(declaration.jsDoc ?? '')
      if (parsedDeclaration.deprecated) continue
      const doc = parsedDeclaration.doc
      const source = pointer(declaration.location)
      if (doc === '') {
        violations.push(`service ctx.${service.key} (${source}): ${declaration.kind} ${declaration.name} has no JSDoc.`)
      }
      const methods: ServiceMethodEntry[] = []
      for (const memberId of service.members) {
        const member = this.renderer.member(memberId)
        if (member.name.startsWith('[')) continue
        const parsed = parseJsDoc(member.jsDoc ?? '')
        if (parsed.deprecated) continue
        if (member.kind === 'property') {
          if (member.jsDoc === undefined) continue
          methods.push({ kind: 'property', signature: member.text, jsDoc: member.jsDoc })
          continue
        }
        if (member.kind !== 'method') continue
        const where = `service method ctx.${service.key}.${member.name} (${pointer(member.location)})`
        if (this.face.face === 'host') {
          checkTypeLinks(where, signatureTypeNames(this.renderer, member.signature), this.policy, typeLinkViolations)
        }
        methods.push({ kind: 'method', signature: member.text, jsDoc: member.jsDoc ?? '' })
        if (member.jsDoc === undefined) {
          violations.push(`${where} has no JSDoc.`)
          continue
        }
        if (parsed.doc === '') violations.push(`${where} has no description prose above its block tags.`)
        checkParams(where, 'service', member.signature.parameters, parsed.params,
          parameter => parameter.receiver, violations)
        checkReturns(where, member.signature, parsed.returns, this.renderer, violations)
      }
      entries.push({
        key: service.key,
        type: declaration.name,
        abstract: declaration.abstract,
        doc,
        methods,
        source,
      })
    }
    reportViolations('gen-cordis-catalog', violations)
    reportTypeLinkViolations('gen-cordis-catalog', typeLinkViolations)
    return entries.sort((left, right) => left.key.localeCompare(right.key))
  }

  private runtimeTypes(
    services: readonly ServiceEntry[],
    events: readonly EventEntry[],
  ): { name: string; declaration: string }[] {
    const declarations = new Map<string, string>()
    const ambiguous = new Set<string>()
    const maxDeclarationChars = this.policy.runtimeDeclarationMaxChars ?? DEFAULT_MAX_DECL_CHARS
    for (const declaration of this.sourceDeclarations) {
      if (declaration.face !== this.face.face
        || (!/^packages\/[^/]+\/[^/]+\/src\/.+\.tsx?$/.test(declaration.location.file)
          && !(declaration.kind === 'enum' && /^vendor\/[^/]+\/src\/.+\.ts$/.test(declaration.location.file)))) continue
      if (declarations.has(declaration.name)) {
        ambiguous.add(declaration.name)
        continue
      }
      declarations.set(
        declaration.name,
        declaration.text.length > maxDeclarationChars
          ? `${declaration.text.slice(0, maxDeclarationChars)} /* …truncated — full shape in source */`
          : declaration.text,
      )
    }
    for (const name of ambiguous) declarations.delete(name)
    return referencedTypes([
      ...services.flatMap(service => service.methods.map(method => method.signature)),
      ...events.map(event => event.signature),
    ], declarations)
  }
}
