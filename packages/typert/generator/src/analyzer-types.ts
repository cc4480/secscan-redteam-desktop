/**
 * The analyzer's type vocabulary: its public results, the compiler-only records the extraction stages hand each other, and the sentinels they compare against.
 *
 * @module @deepseek-ai/dsh-typert-generator/analyzer-types
 */

import ts from 'typescript'
import type {
  DocumentationModel,
  ExportModel,
  SymbolId,
  TypeNodeId,
  TypeNodeModel,
  TypertFace,
} from './model.ts'

/** The model node type without its compiler-assigned id. */
export type WithoutId<T> = T extends { readonly id: TypeNodeId } ? Omit<T, 'id'> : never

/** One model node before the graph assigns its id. */
export type TypeNodeInput = WithoutId<TypeNodeModel>

/** Packages whose exported types may appear in a Remote boundary. */
export const PUBLIC_REMOTE_TYPE_ROOTS = new Set([
  '@deepseek-ai/dsh-util-values',
])

/** Analysis failure with a source-oriented diagnostic. */
export class TypertAnalysisError extends Error {
  override name = 'TypertAnalysisError'
}

/** Internal signal that write mode queued the annotation it needs. */
export class SourceEditQueued extends Error {}

/** Missing-annotation handling at public business boundaries. */
export type AnalysisMode = 'check' | 'write'


/** One package face whose public export graph contains Typert business declarations. */
export interface DiscoveredTypertPackage {
  readonly package: string
  readonly root: string
  readonly faces: readonly TypertFace[]
}

/** One parsed tsconfig, memoizable per workspace snapshot. */
export interface ParsedConfig {
  /** Absolute config path. */
  readonly path: string
  /** The TypeScript parse result. */
  readonly parsed: ts.ParsedCommandLine
}

/** One package face registration discovered from an aggregate tsconfig. */
export interface PackageRegistration {
  /** The face whose aggregate references this package project. */
  readonly face: TypertFace
  /** The package manifest name. */
  readonly name: string
  /** Real package root directory. */
  readonly root: string
  /** The package's own parsed tsconfig. */
  readonly config: ParsedConfig
  /** The parsed package.json content. */
  readonly manifest: Record<string, unknown>
  /** Export subpaths owned by this face for dual-face packages. */
  readonly exportSubpaths?: readonly string[]
}

/** One exported declaration of a package face and the symbol it came from. */
export interface ExportRecord {
  readonly model: ExportModel
  readonly symbol: ts.Symbol
  readonly declaration: ts.Declaration
  readonly sourceFile: ts.SourceFile
}

/** One queued annotation insertion. */
export interface SourceEdit {
  readonly file: string
  readonly position: number
  readonly text: string
}

/** One module specifier split into its package and subpath. */
export interface ModuleIdentity {
  readonly package: string
  readonly subpath: string
}

/** The package import a type reference reaches after following package-local forwarding modules. */
export interface PackageImport {
  readonly module: ModuleIdentity
  /** Name the type is exported under at that package subpath. */
  readonly name: string
}

/** One `import` binding of a local name; `name` is absent for a namespace import. */
export interface ImportBinding {
  readonly specifier: string
  readonly name?: string
}

/** One outgoing `export` edge of a forwarding module for one exported name. */
export interface ForwardedExport {
  readonly specifier: string
  readonly name: string
}

/** One static Typert lookup declaration read off a merged interface. */
export interface StaticLookupDeclaration {
  readonly key: string
  readonly hostSymbol: SymbolId
  readonly wireType: ts.TypeNode
  readonly site: ts.Node
}

/** One static Context member declaration read off a merged interface. */
export interface StaticContextDeclaration {
  readonly key: string
  readonly wireType: ts.TypeNode
  readonly site: ts.Node
}

/** One Gateway service binding declared by a Host-for-Client contribution. */
export interface GatewayBinding {
  readonly service: string
  readonly namespace: string
  readonly site: ts.Node
}

/** The reference syntaxes a type import is recovered from. */
export type ReferenceSite = ts.TypeReferenceNode | ts.ExpressionWithTypeArguments | ts.ImportTypeNode

/** The documentation of a declaration that carries none. */
export const EMPTY_DOCUMENTATION: DocumentationModel = { tags: [] }

/** One face's compiler host and the parsed source files it shares. */
export interface FaceProgramHost {
  readonly host: ts.CompilerHost
  readonly files: Map<string, ts.SourceFile | undefined>
}

