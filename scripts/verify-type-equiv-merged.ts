/** Merged rendering of an interface plus its explicitly named module augmentations. */

import type { ManifestEntry } from './verify-type-equiv-model.ts'
import {
  augmentedInterface,
  sourceInterface,
  sourceJSDoc,
  type InterfacePart,
} from './verify-type-equiv-declarations.ts'

/** Render one interface plus explicitly named module augmentations as its merged declaration. */
export function mergedInterfaceDeclaration(entry: ManifestEntry): string | null {
  const base = sourceInterface(entry.source, entry.symbol)
  if (base === null) return null
  const additions: InterfacePart[] = []
  for (const augmentation of entry.augmentations ?? []) {
    const part = augmentedInterface(augmentation.source, augmentation.module, entry.symbol)
    if (part === null) return null
    additions.push(part)
  }

  const parts = [base, ...additions]
  const docs = parts.map(part => sourceJSDoc(part.text, part.declaration)).filter(Boolean)
  const typeParameters = base.declaration.typeParameters
    ?.map(parameter => parameter.getText(base.sourceFile)).join(', ')
  const heritage = parts.flatMap(part =>
    part.declaration.heritageClauses?.map(clause => clause.getText(part.sourceFile)) ?? [],
  ).join(' ')
  const header = `interface ${entry.symbol}${typeParameters ? `<${typeParameters}>` : ''}${heritage ? ` ${heritage}` : ''} {`
  const members = parts.flatMap(part => part.declaration.members.map((member) => {
    const jsDoc = sourceJSDoc(part.text, member)
    const declaration = part.text.slice(member.getStart(part.sourceFile), member.getEnd())
    return jsDoc === '' ? declaration : `${jsDoc}\n${declaration}`
  }))
  const declaration = [header, ...members.map(member => member.split('\n').map(line => `  ${line}`).join('\n')), '}'].join('\n')
  return docs.length === 0 ? declaration : `${docs.join('\n')}\n${declaration}`
}
