/** Sidebar shell style contracts shared with its slot-owned controls. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/SidebarRoot.module.css', import.meta.url)), 'utf8')

/**
 * Declarations of one exact selector, keyed by property.
 * @param selector - exact selector text.
 * @returns the normalized declarations, or undefined when absent.
 */
function declarations(selector: string): Map<string, string> | undefined {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  for (const [, selectorList = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorList.split(',').map(value => value.trim()).includes(selector)) continue
    const found = new Map<string, string>()
    for (const part of body.split(';')) {
      const colon = part.indexOf(':')
      if (colon === -1) continue
      found.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, ' '))
    }
    return found
  }
  return undefined
}

describe('SidebarRoot.module.css', () => {
  it('shares and cancels the wide shell trailing padding structurally', () => {
    const root = declarations('.root')
    expect(root?.get('--dsh-sidebar-inline-padding')).toBe('12px')
    expect(root?.get('padding')).toBe('8px var(--dsh-sidebar-inline-padding)')
    expect(declarations('.regionArea')?.get('margin-left')).toBe('-4px')
    expect(declarations('.regionArea')?.get('padding-left')).toBe('4px')
    expect(declarations('.regionArea')?.get('margin-right')).toBe(
      'calc(-1 * var(--dsh-sidebar-inline-padding))',
    )
    expect(declarations('.collapsed .regionArea')?.get('margin-left')).toBe('0')
    expect(declarations('.collapsed .regionArea')?.get('padding-left')).toBe('0')
    expect(declarations('.collapsed .regionArea')?.get('margin-right')).toBe('0')
  })

  it('moves the four upper controls while the settings seat only fades', () => {
    const animation = 'rail-in 150ms var(--ds-ease-in-out) backwards'
    for (const selector of [
      '.railIn .iconButton',
      '.railIn .newSession',
      '.railIn .regionArea',
    ]) {
      expect(declarations(selector)?.get('animation')).toBe(animation)
    }
    expect(declarations('.railIn .footArea')?.get('animation')).toBe(
      'rail-fade-in 150ms var(--ds-ease-in-out) backwards',
    )
    expect(css).toMatch(
      /@keyframes rail-in\s*\{\s*from\s*\{\s*opacity: 0;\s*transform: translateX\(49px\);\s*}\s*}/,
    )
    expect(css).toMatch(/@keyframes rail-fade-in\s*\{\s*from\s*\{\s*opacity: 0;\s*}\s*}/)
  })

  it('gives shell rail controls the same base anchor for their shared translation', () => {
    expect(declarations('.collapsed .logoRow')?.get('justify-content')).toBe('flex-start')
    expect(declarations('.collapsed .newSession')?.get('align-self')).toBe('flex-start')
    expect(declarations('.collapsed .newSession')?.get('width')).toBe('36px')
  })

  it('keeps one uniform menu cadence in both states', () => {
    // 36px controls; the expanded stack runs tight at 8px between blocks
    // and panel rows, while the rail keeps its own 12px rhythm.
    expect(declarations('.logoRow')?.get('margin-bottom')).toBe('8px')
    expect(declarations('.newSession')?.get('height')).toBe('36px')
    expect(declarations('.newSession')?.get('margin')).toBe('0 2px 8px')
    expect(declarations('.panelList')?.get('gap')).toBe('8px')
    expect(declarations('.panelList')?.get('margin-bottom')).toBe('8px')
    expect(declarations('.collapsed .panelList')?.get('gap')).toBe('12px')
    expect(declarations('.panelRow')?.get('height')).toBe('36px')
    expect(declarations('.collapsed .panelRow')?.get('height')).toBe('36px')
  })

  it('seats the brand apart from the collapse toggle in the rail', () => {
    expect(declarations('.railBrand')?.get('width')).toBe('36px')
    expect(declarations('.railBrand')?.get('height')).toBe('36px')
    expect(declarations('.toggleRow')?.get('margin-bottom')).toBe('12px')
    // The mark no longer rides inside the toggle: no swap rules remain.
    expect(css).not.toContain('railMark')
    expect(css).not.toContain('.collapsed .toggle .panelIcon')
  })

  it('keeps the Windows sidebar in flow: no fixed caption seats remain', () => {
    // The caption-seat design stranded the operator: the seats were fixed
    // descendants of .root, whose dark-theme backdrop-filter makes it
    // their containing block, so the zero-width collapsed column clipped
    // them away. The rail replaced them — nothing in this sheet is fixed.
    expect(css).not.toContain('position: fixed')
    expect(declarations(':global([data-windows-titlebar]) .collapsed .railBrand')).toBeUndefined()
    expect(declarations(':global([data-windows-titlebar]) .collapsed .toggle')).toBeUndefined()
    expect(declarations(':global([data-windows-titlebar]) .collapsed .newSession')).toBeUndefined()
    expect(
      declarations(":global(html[data-windows-titlebar]:has([data-sidebar-collapsed='true']))")
        ?.get('--dsh-windows-menu-start'),
    ).toBeUndefined()
    // Expanded, the logo row still matches the caption strip's height, and
    // the collapsed brand seat takes the shared dark glass tile.
    expect(
      declarations(':global([data-windows-titlebar]) .root:not(.collapsed) .logoRow')?.get('height'),
    ).toBe('40px')
    expect(
      declarations(':global([data-ds-dark-theme]) .collapsed .railBrand')?.get('border-radius'),
    ).toBe('11px')
  })

  it('top-anchors the brand and panel list, pooling free space in the region area', () => {
    // Layout contract (operator order): the brand hugs the top of the
    // column (flex: none) and the panel list hugs its rows directly
    // under it (flex: 0 1 auto) while still shrinking and scrolling
    // internally (min-height: 0, overflow-y: auto), so every registered
    // panel row stays reachable. The region area is the sole grower
    // (flex: 1, min-height: 0): all leftover height pools below the
    // nav, at the bottom of the sidebar.
    expect(declarations('.brand')?.get('flex')).toBe('none')
    const list = declarations('.panelList')
    expect(list?.get('flex')).toBe('0 1 auto')
    expect(list?.get('min-height')).toBe('0')
    expect(list?.get('overflow-y')).toBe('auto')
    expect(declarations('.regionArea')?.get('flex')).toBe('1')
    expect(declarations('.regionArea')?.get('min-height')).toBe('0')
  })

  it('keeps the slotted brand row at the full artwork height', () => {
    expect(declarations('.brandIdentity')?.get('height')).toBe('32px')
    expect(declarations('.brandName')?.get('height')).toBe('32px')
    expect(declarations('.brandName')?.get('line-height')).toBe('32px')
    expect(declarations('.brandName')?.get('font-size')).toBe('20px')
    expect(declarations('.fallbackBrandName')?.get('font-size')).toBe('18px')
    expect(declarations('.fallbackBrandName')?.get('white-space')).toBe('nowrap')
  })
})
