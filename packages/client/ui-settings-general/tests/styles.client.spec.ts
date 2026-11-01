/**
 * Settings shell stylesheet contract, asserted against the source on disk.
 *
 * The settings panel is a full-viewport surface: it only behaves as one if
 * it renders outside any transformed or filtered ancestor and if content
 * that outgrows it stays reachable. Both failure modes are silent in the
 * browser — the panel paints, clipped, and nothing reports it — so the
 * wiring is asserted here instead.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/SettingsRoot.module.css', import.meta.url)), 'utf8')
const root = readFileSync(fileURLToPath(new URL('../src/client/SettingsRoot.tsx', import.meta.url)), 'utf8')

/** The declarations of one top-level rule, by selector. */
function block(selector: string): string {
  const match = new RegExp(`^\\${selector} \\{([^}]*)\\}`, 'm').exec(css)
  if (match === null) throw new Error(`SettingsRoot.module.css has no \`${selector}\` rule`)
  return match[1] ?? ''
}

describe('SettingsRoot panel placement', () => {
  it('portals the open panel to the document body', () => {
    // The panel mounts from inside the sidebar column, whose glass surface
    // filters its backdrop; a filtered ancestor becomes the containing
    // block for fixed descendants, so an inline `position: fixed` overlay
    // resolves against the column instead of the viewport and the panel is
    // squeezed into it. Every other overlay in the client portals for this
    // reason; the settings panel must too.
    expect(root).toContain('createPortal(')
    expect(root).toContain('document.body')
  })

  it('keeps overflowing section content reachable inside the options pane', () => {
    // The panel clips its own overflow for the rounded corners, so the
    // options pane is the only scroll surface a section has. Vertical-only
    // scrolling strands any content wider than the pane off its right edge
    // with no way to reach it.
    expect(block('.options')).toContain('overflow-x: auto')
    expect(block('.options')).toContain('overflow-y: auto')
  })

  it('stacks the panel vertically on narrow viewports', () => {
    // Below the width where nav and content can sit side by side, the
    // horizontal panel leaves the content a sliver. The narrow layout turns
    // the nav into a band above the content and gives the panel the full
    // viewport width and height.
    expect(css).toContain('@media (max-width: 700px)')
    const narrow = css.slice(css.indexOf('@media (max-width: 700px)'))
    expect(narrow).toMatch(/\.panel\s*\{[^}]*flex-direction: column/)
    expect(narrow).toMatch(/\.nav\s*\{[^}]*width: auto/)
    expect(narrow).toMatch(/\.navList\s*\{[^}]*flex-direction: row/)
  })
})
