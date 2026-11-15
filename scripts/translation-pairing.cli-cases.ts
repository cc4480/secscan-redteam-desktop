/** Regression cases for translation pairing CLI argument parsing. */

import { describe, expect, it } from 'vitest'
import { pairAnchorOfArgument, parseTranslationPairingCliArgs } from './translation-pairing.ts'

describe('pair CLI arguments', () => {
  it('normalizes any pair file or bare stem to the English anchor', () => {
    expect(pairAnchorOfArgument('docs/foo.md')).toBe('docs/foo.md')
    expect(pairAnchorOfArgument('docs/foo.zh.md')).toBe('docs/foo.md')
    expect(pairAnchorOfArgument('docs/foo.i18n.yaml')).toBe('docs/foo.md')
    expect(pairAnchorOfArgument('docs/foo')).toBe('docs/foo.md')
    expect(pairAnchorOfArgument('.\\docs\\foo.zh.md')).toBe('docs/foo.md')
  })

  it('scopes a check to named pairs and dedupes the three spellings', () => {
    expect(parseTranslationPairingCliArgs(['docs/foo.zh.md', 'docs/foo.i18n.yaml', 'docs/bar.md'])).toEqual({
      input: 'worktree',
      mode: 'check',
      scope: 'pairs',
      anchors: ['docs/bar.md', 'docs/foo.md'],
    })
    expect(parseTranslationPairingCliArgs([])).toEqual({
      input: 'worktree',
      mode: 'check',
      scope: 'corpus',
      anchors: [],
    })
  })

  it('requires --write to name confirmed pairs or opt into --all', () => {
    expect(() => parseTranslationPairingCliArgs(['--write'])).toThrow('requires the pair(s) you confirmed')
    expect(parseTranslationPairingCliArgs(['--write', 'docs/foo.md'])).toEqual({
      input: 'worktree',
      mode: 'write',
      scope: 'pairs',
      anchors: ['docs/foo.md'],
    })
    expect(parseTranslationPairingCliArgs(['--write', '--all'])).toEqual({
      input: 'worktree',
      mode: 'write',
      scope: 'corpus',
      anchors: [],
    })
    expect(() => parseTranslationPairingCliArgs(['--write', '--all', 'docs/foo.md'])).toThrow('not both')
  })

  it('keeps --list corpus-only and rejects unknown flags', () => {
    expect(parseTranslationPairingCliArgs(['--list'])).toEqual({
      input: 'worktree',
      mode: 'list',
      scope: 'corpus',
      anchors: [],
    })
    expect(() => parseTranslationPairingCliArgs(['--list', 'docs/foo.md'])).toThrow('takes no other flags or paths')
    expect(() => parseTranslationPairingCliArgs(['--all'])).toThrow('--all only applies to --write')
    expect(() => parseTranslationPairingCliArgs(['--frobnicate'])).toThrow('unknown flag(s): --frobnicate')
  })

  it('makes cached verification a named, read-only index check', () => {
    expect(parseTranslationPairingCliArgs(['--cached', 'docs/foo.i18n.yaml'])).toEqual({
      input: 'index',
      mode: 'check',
      scope: 'pairs',
      anchors: ['docs/foo.md'],
    })
    expect(() => parseTranslationPairingCliArgs(['--cached'])).toThrow('requires the staged pair paths')
    expect(() => parseTranslationPairingCliArgs(['--cached', '--write', 'docs/foo.md'])).toThrow('read-only')
  })
})
