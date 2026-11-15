/**
 * Reading the occupancy side of the surface: every `slots.register` /
 * `slots.registerFactory` call site, the component and cell identity it passes,
 * and the ordinary child slots it declares.
 */

import ts from 'typescript'
import { collapse, lineOf, memberName } from './slot-walk-text.ts'
import type { ScannedFile, SlotRegistration } from './slot-walk-types.ts'

/**
 * Read every Slot or Factory registration call site in one scanned file: which
 * name it targets, with which component and cell identity, and which ordinary
 * child slots it declares. A call whose `name` is not a string literal is skipped — the
 * shipped composition always names its target literally, and a computed name
 * carries no catalog fact.
 * @param file - a file returned by {@link scanSlotFiles}.
 * @returns the registrations, in source order.
 */
export function slotRegistrations(file: ScannedFile): SlotRegistration[] {
  const out: SlotRegistration[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && (node.expression.name.text === 'register' || node.expression.name.text === 'registerFactory')
      && isSlotsReceiver(node.expression.expression, file.sf)
      && node.arguments.length >= 1) {
      const options = node.arguments[0]
      if (options !== undefined && ts.isObjectLiteralExpression(options)) {
        const key = stringProperty(options, 'name')
        if (key !== undefined) {
          const id = stringProperty(options, 'id')
          const entryKey = stringProperty(options, 'key')
          out.push({
            key,
            package: file.package,
            component: componentText(node.arguments[1], file.sf),
            ...node.expression.name.text === 'registerFactory' ? { factory: true } : {},
            ...id === undefined ? {} : { id },
            ...entryKey === undefined ? {} : { entryKey },
            children: childKeys(options),
            source: `${file.rel}:${String(lineOf(file.sf, node))}`,
          })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file.sf)
  return out
}

/**
 * Whether a `X.register(...)` receiver is the slots service. Every other
 * registry in the repo (`ctx.tools`, `ctx.commands`, `ctx.settings`, …) also
 * takes an options object with a `name`, so the receiver is what separates a
 * slot occupancy fact from an unrelated registration.
 */
function isSlotsReceiver(receiver: ts.Expression, sf: ts.SourceFile): boolean {
  const text = receiver.getText(sf)
  return text === 'slots' || text.endsWith('.slots')
}

/** One string-literal property of an options object literal. */
function stringProperty(options: ts.ObjectLiteralExpression, name: string): string | undefined {
  for (const property of options.properties) {
    if (!ts.isPropertyAssignment(property)) continue
    if (memberName(property.name) !== name) continue
    if (ts.isStringLiteral(property.initializer)) return property.initializer.text
  }
  return undefined
}

/** The SlotMap keys a registration's `children` table declares. */
function childKeys(options: ts.ObjectLiteralExpression): string[] {
  for (const property of options.properties) {
    if (!ts.isPropertyAssignment(property)) continue
    if (memberName(property.name) !== 'children') continue
    if (!ts.isObjectLiteralExpression(property.initializer)) return []
    return property.initializer.properties
      .flatMap(child => (child.name === undefined ? [] : [memberName(child.name)]))
  }
  return []
}

/** The component argument as written; a non-identifier expression is collapsed. */
function componentText(argument: ts.Expression | undefined, sf: ts.SourceFile): string {
  if (argument === undefined) return '(none)'
  const text = collapse(argument.getText(sf))
  return text.length > 60 ? `${text.slice(0, 57)}…` : text
}
