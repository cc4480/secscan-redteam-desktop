/**
 * The live composition records a renderer reads: occupants of one slot, the
 * resolved live node, and the factory and composition node unions.
 */
import type { SlotKind, SlotScope } from './slots-definition-types.ts'

/** JSON-safe live occupant returned by slot inspection. */
export interface LiveSlotOccupant {
  /** Plugin or package that registered the entry, when known. */
  registrant?: string
  /** Keyed-slot cell. */
  key?: string
  /** List-slot cell. */
  id?: string
  /** List display order. */
  order?: number
  /** Shadowing or chain priority. */
  priority: number
  /** Whether the renderer currently selects this entry. */
  active: boolean
}

/** JSON-safe live Slot declaration tree. */
export interface LiveSlotNode {
  /** Discriminant for an ordinary Slot declaration. */
  type: 'slot'
  /** Exact SlotMap key. */
  name: string
  /** Slot cardinality. */
  kind: SlotKind
  /** Runtime data scope. */
  scope: SlotScope
  /** Diagnostic owner of this declaration. */
  declaredBy?: string
  /** Current registrations in ledger order. */
  occupants: LiveSlotOccupant[]
  /** Slots declared by entries mounted in this slot. */
  children: LiveSlotNode[]
}

/** JSON-safe live Factory definition with its ordinary child Slot tree. */
export interface LiveFactoryNode {
  /** Discriminant for a reusable Factory definition. */
  type: 'factory'
  /** Exact SlotFactoryMap key. */
  name: string
  /** Runtime data scope inherited by each occurrence. */
  scope: SlotScope
  /** Plugin or package that registered the definition, when known. */
  registrant?: string
  /** Ordinary Slots declared by the Factory definition. */
  children: LiveSlotNode[]
}

/** One root in the live Slot/Factory composition topology. */
export type LiveCompositionNode = LiveSlotNode | LiveFactoryNode
