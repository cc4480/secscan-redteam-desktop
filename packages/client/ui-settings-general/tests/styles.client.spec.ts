/**
 * Settings shell placement and stylesheet contract, asserted against the
 * source on disk.
 *
 * The panel is one of the shell's frame-wide overlay surfaces: it renders
 * from the `shell.overlay` seat inside the frame, above the columns and
 * outside their scroll containers. Both failure modes this guards are
 * silent in the browser — the panel paints, clipped or misplaced, and
 * nothing reports it — so the wiring is asserted here instead. Each test
 * states only what its assertions read.
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (name: string) => readFileSync(fileURLToPath(new URL(`../src/client/${name}`, import.meta.url)), 'utf8')
const readIfPresent = (name: string) => {
  const path = fileURLToPath(new URL(`../src/client/${name}`, import.meta.url))
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}
const css = read('SettingsRoot.module.css')
const root = read('SettingsRoot.tsx')
const overlay = readIfPresent('SettingsOverlay.tsx')
const apply = read('index.ts')

/** The declarations of one top-level rule, by selector. */
function block(selector: string): string {
  const match = new RegExp(`^\\${selector} \\{([^}]*)\\}`, 'm').exec(css)
  if (match === null) throw new Error(`SettingsRoot.module.css has no \`${selector}\` rule`)
  return match[1] ?? ''
}

describe('Settings panel placement', () => {
  it('registers the panel into the shell overlay layer and never portals to the document body', () => {
    // The frame owns a frame-wide overlay layer (ui-layout's `shell.overlay`
    // seat, rendered inside the frame above every column). The panel is an
    // occupant of that layer: registered beside the trigger's own package,
    // sharing its store. A body portal would leave the frame's stacking
    // context; rendering inside the sidebar column leaves the panel sized
    // and positioned by the column instead of the frame.
    expect(apply).toContain("slots.inject('shell.overlay'")
    expect(apply).toContain('SettingsOverlay')
    expect(root + overlay).not.toContain('createPortal')
    expect(root + overlay).not.toContain('document.body')
  })

  it('anchors the overlay to the shell layer and sizes the panel against it', () => {
    // The layer is an absolutely positioned frame-sized box, so the
    // occupant's overlay anchors to it with `absolute`, and the panel's
    // max-width resolves against the layer's width — a viewport-relative
    // cap would drift from the surface the panel actually sits in.
    expect(block('.overlay')).toContain('position: absolute')
    expect(block('.overlay')).not.toContain('position: fixed')
    expect(block('.panel')).toContain('max-width: calc(100% - 48px)')
    expect(block('.panel')).not.toContain('100vw')
  })

  it('keeps horizontal overflow inside the sections instead of the shared options pane', () => {
    // The options pane is every section's shared scroll surface. A
    // horizontal axis on it would let one wide section push the pane —
    // and the panel's clipping edge — sideways for all of them; overflow
    // belongs to the card that produces it (the Models editor carries its
    // own), so this pane scrolls vertically only.
    expect(block('.options')).not.toContain('overflow-x')
    expect(block('.options')).toContain('overflow-y: auto')
  })

  it('stacks the panel under the shared narrow breakpoint', () => {
    // 720px is the narrow-panel breakpoint the sibling sheets already use
    // (ui-user-questions' panels); the panel stacks there — nav becomes a
    // band above the content — instead of squeezing the two side by side.
    expect(css).toContain('@media (max-width: 720px)')
    const narrow = css.slice(css.indexOf('@media (max-width: 720px)'))
    expect(narrow).toMatch(/\.panel\s*\{[^}]*flex-direction: column/)
    expect(narrow).toMatch(/\.nav\s*\{[^}]*width: auto/)
    expect(narrow).toMatch(/\.navList\s*\{[^}]*flex-direction: row/)
    expect(css).not.toContain('@media (max-width: 700px)')
  })
})
