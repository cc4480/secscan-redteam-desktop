// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { GlassSurface } from '../src/Glass.tsx'
import glassCss from '../src/Glass.module.css'

afterEach(cleanup)

describe('GlassSurface', () => {
  it('renders the panel variant by default and composes the host class', () => {
    const { container } = render(<GlassSurface className="host-seat">content</GlassSurface>)
    const el = container.firstElementChild!
    expect(el.textContent).toBe('content')
    expect(el.className).toContain(glassCss.glass)
    expect(el.className).toContain(glassCss.panel)
    expect(el.className).toContain('host-seat')
    expect(el.className).not.toContain(glassCss.sheen)
  })

  it('renders card and well variants, with the sheen class only when requested', () => {
    const card = render(<GlassSurface variant="card" sheen>card</GlassSurface>)
    expect(card.container.firstElementChild!.className).toContain(glassCss.card)
    expect(card.container.firstElementChild!.className).toContain(glassCss.sheen)
    card.unmount()

    const well = render(<GlassSurface variant="well">well</GlassSurface>)
    expect(well.container.firstElementChild!.className).toContain(glassCss.well)
    expect(well.container.firstElementChild!.className).not.toContain(glassCss.sheen)
  })
})
