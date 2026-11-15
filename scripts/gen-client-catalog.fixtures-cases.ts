/** Hand-built slot declarations, registrations, and owner types shared by the catalog cases. */

import type { SlotDeclaration, SlotRegistration, TypeDeclaration } from './slot-walk.ts'

/** A declaration with every field the catalog needs, overridable per case. */
export function declaration(over: Partial<SlotDeclaration> = {}): SlotDeclaration {
  return {
    key: 'demo.seat',
    kind: 'single',
    scope: 'root',
    jsDoc: '/** A seat. Registering here replaces the shipped entry. */',
    package: '@deepseek-ai/dsh-client-demo',
    source: 'packages/client/demo/src/client/contract/slots.ts:1',
    ...over,
  }
}

/** A registration into `demo.seat`, overridable per case. */
export function registration(over: Partial<SlotRegistration> = {}): SlotRegistration {
  return {
    key: 'demo.seat',
    package: '@deepseek-ai/dsh-client-demo',
    component: 'DemoSeat',
    children: [],
    source: 'packages/client/demo/src/client/index.ts:10',
    ...over,
  }
}

/** An exported owner-props declaration the catalog can resolve. */
export const OWNER_TYPES = new Map<string, TypeDeclaration>([
  ['DemoOwnerProps', {
    name: 'DemoOwnerProps',
    text: '/** Owner share. */\nexport interface DemoOwnerProps {\n  /** Column width. */\n  width: number\n}',
    source: 'packages/client/demo/src/client/contract/slots.ts:20',
  }],
])
