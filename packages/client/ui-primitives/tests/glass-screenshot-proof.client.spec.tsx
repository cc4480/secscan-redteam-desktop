// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DiamondLogo } from '../src/DiamondLogo.tsx'

afterEach(cleanup)

const packageDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(packageDir, '..', '..', '..', '..')
const readRepo = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8')

function findWorkspaceRoot(): string {
  let dir = repoRoot
  for (let i = 0; i < 4; i++) {
    if (existsSync(join(dir, 'goals', 'secscan-redteam-pentest-agents'))) return dir
    dir = dirname(dir)
  }
  throw new Error('workspace goals directory not found above the repo root')
}

function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path)
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

describe('glass shell — screenshot proof (Q-UI-GLASS truth pass)', () => {
  it('glass-shell.css carries the locked dark glass tokens verbatim', () => {
    const css = readRepo('packages/client/ui-layout/src/client/glass-shell.css')
    for (const token of [
      '--glass: rgba(255, 255, 255, 0.09)',
      '--glass-hi: rgba(255, 255, 255, 0.11)',
      '--glass-strong: rgba(255, 255, 255, 0.14)',
      '--glass-line: rgba(255, 255, 255, 0.09)',
      '--well: rgba(0, 0, 0, 0.34)',
      '--glass-blur: blur(18px) saturate(165%) brightness(1.05)',
      '--glass-blur-float: blur(22px) saturate(170%) brightness(1.06)',
      '--glass-solid: #0d0d10',
      '--glass-card-solid: #232329',
      '--shadow: 0 16px 40px rgba(0, 0, 0, 0.45)',
      '--shadow-lift: 0 22px 48px rgba(0, 0, 0, 0.55)',
      '--shadow-panel: 0 4px 8px rgba(0, 0, 0, 0.4), 0 12px 24px rgba(0, 0, 0, 0.35), 0 24px 48px rgba(0, 0, 0, 0.22)',
      '--shadow-card: 0 1px 2px rgba(0, 0, 0, 0.35), 0 2px 6px rgba(0, 0, 0, 0.25)',
      'inset 0 1px 1px rgba(255, 255, 255, 0.38)',
      'inset 0 -1px 1px rgba(255, 255, 255, 0.3)',
    ]) {
      expect(css).toContain(token)
    }
  })

  it('motion tokens use the house ease-out, collapse under reduced motion, and never spring on data surfaces', () => {
    const css = readRepo('packages/client/ui-layout/src/client/glass-shell.css')
    expect(css).toContain('--ease-out: cubic-bezier(0.22, 1, 0.36, 1)')
    expect(css).toContain('--dur-hero: 720ms')
    expect(css).toContain('--stagger: 60ms')
    expect(css).toContain('--lift: -2px')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).not.toContain('--ease-spring')
  })

  it('DiamondLogo renders square with fixed fills and no currentColor', () => {
    const { container } = render(<DiamondLogo size={34} />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('viewBox')).toBe('0 0 100 100')
    expect(svg.getAttribute('width')).toBe('34')
    expect(svg.getAttribute('height')).toBe('34')
    expect(svg.innerHTML).toContain('fill="#CF2B4D"')
    expect(svg.innerHTML).toContain('#38BDF8')
    expect(svg.innerHTML).not.toContain('currentColor')
  })

  it('the brand package seats the diamond in the sidebar and the hero in every profile', () => {
    const index = readRepo('packages/client/ui-brand-official/src/client/index.ts')
    const brand = readRepo('packages/client/ui-brand-official/src/client/Brand.tsx')
    expect(index).not.toContain('DSH_CLIENT_BUILD_PROFILE')
    expect(index).toContain("'sidebar.brand.mark'")
    expect(index).toContain("'conversation.hero.brand.mark'")
    expect(brand).toContain('export function OfficialBrandMark')
    expect(brand).toContain('export function OfficialHeroBrandMark')
    expect(brand).toContain('<DiamondLogo size={size} />')
    expect(brand).toContain('<DiamondLogo size={size} className={className} />')
  })

  it('the hero fallback is the diamond; no shield glyph or swim rides the hero mark', () => {
    const hero = readRepo('packages/client/ui-conversation/src/client/skeleton/EmptyHero.tsx')
    expect(hero).not.toContain('FISH_LOGO')
    expect(hero).not.toContain('fishSwim')
    expect(hero).toContain("renderSlot('conversation.hero.brand.mark', { size: 34, className: css.fish }")
    expect(hero).toContain('<DiamondLogo size={34} className={css.fish} />')
  })

  it('the glass-verify receipts exist with the recorded dimensions', () => {
    const dir = join(findWorkspaceRoot(), 'goals', 'secscan-redteam-pentest-agents', 'files', 'glass-verify-2026-10-31')
    expect(pngSize(join(dir, 'hero-diamond-verified.png'))).toEqual({ width: 760, height: 560 })
    expect(pngSize(join(dir, 'rail-glass-shell.png'))).toEqual({ width: 1180, height: 720 })
  })

  it('the receipt harness composes the real token sheet and the real mark', () => {
    const scratch = join(findWorkspaceRoot(), 'goals', 'secscan-redteam-pentest-agents', 'hidden_files', 'brand-scratch', 'uiglass-receipts')
    const hero = readFileSync(join(scratch, 'hero-harness.html'), 'utf8')
    const shell = readFileSync(join(scratch, 'shell-harness.html'), 'utf8')
    for (const page of [hero, shell]) {
      expect(page).toContain('--glass-blur: blur(18px) saturate(165%) brightness(1.05)')
      expect(page).toContain('fill="#d92344"')
      expect(page).toContain('data-ds-dark-theme')
    }
    expect(hero).toContain('width="34"')
    expect(shell).toContain('width="24"')
  })
})
