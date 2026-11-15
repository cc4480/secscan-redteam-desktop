/**
 * The records the slot walk returns to the catalog generator: one declared
 * `SlotMap` member, one registration call site, one exported type declaration,
 * and one scanned source file.
 */

import ts from 'typescript'

/** One `SlotMap` member: the slot's contract as its owning package declares it. */
export interface SlotDeclaration {
  /** SlotMap key, e.g. `settings.section`. */
  key: string
  /** Cardinality literal (`single` / `list` / `keyed` / `chain`), or '' when not a literal. */
  kind: string
  /** Data-scope literal (`root` / `session` / `session-maybe`), or '' when not a literal. */
  scope: string
  /** Type name of the owner-supplied props share, absent when the slot declares none. */
  ownerType?: string
  /** Source text of the `keyProps` member (keyed slots), absent otherwise. */
  keyProps?: string
  /** Source text of the `hookContext` member, absent otherwise. */
  hookContext?: string
  /** Type name of the slot-level inject face, absent when the slot declares none. */
  injectType?: string
  /** The member's JSDoc with container indentation removed, '' when undocumented. */
  jsDoc: string
  /** Workspace package that declares the contract. */
  package: string
  /** Source pointer `packages/…/file.ts:line`. */
  source: string
}

/** One `slots.register()` or `slots.registerFactory()` call site. */
export interface SlotRegistration {
  /** Target SlotMap key the entry contributes into. */
  key: string
  /** Workspace package that registers the entry. */
  package: string
  /** Component argument as written (identifier, or a trimmed expression). */
  component: string
  /** `id` literal of a list entry, absent otherwise. */
  id?: string
  /** `key` literal of a keyed entry, absent otherwise. */
  entryKey?: string
  /** SlotMap keys this registration declares as children (they exist while it is mounted). */
  children: string[]
  /** Whether this call installs a Factory definition instead of occupying an ordinary Slot. */
  factory?: boolean
  /** Source pointer `packages/…/file.ts:line`. */
  source: string
}

/** One exported type declaration, retained with its JSDoc for catalog projection. */
export interface TypeDeclaration {
  /** Declared name. */
  name: string
  /** Full declaration text INCLUDING its JSDoc (member docs are the teaching text). */
  text: string
  /** Source pointer `packages/…/file.ts:line`. */
  source: string
}

/** One scanned source file with the artifacts the catalog reads from it. */
export interface ScannedFile {
  /** Repo-relative, `/`-normalized path. */
  rel: string
  /** Workspace package name that owns the file. */
  package: string
  /** Parsed source file. */
  sf: ts.SourceFile
}
