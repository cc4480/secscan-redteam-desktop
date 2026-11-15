/** The single assertion: pairing and key comparison over every discovered dictionary. */

import { dirname } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  dictionariesIn,
  localeOf,
  type Dictionary,
} from './locale-dictionary-parity.dictionaries-cases.ts'
import { relative, sourceFiles } from './locale-dictionary-parity.sources-cases.ts'

describe('shipped locale dictionaries', () => {
  // This one assertion parses every shipped source file (500+) into a
  // TypeScript AST, which is filesystem- and parser-bound: it completes and
  // passes in ~5.5 s on a Windows host, just past the 5 s default, and it is
  // the only test in this file. A budget sized for the work is honest; the
  // sweep is not widened to fit the clock.
  it('declares the same keys in zh and en, so the single fallback locale always resolves', () => {
    const files = sourceFiles()
    // Guard the discovery itself: an empty or narrowed sweep would pass every
    // assertion below while checking nothing.
    expect(files.length).toBeGreaterThan(500)

    // Pair within a file first; a dictionary whose counterpart is not in the
    // same module then pairs with a sibling in the same directory. Both shapes
    // ship here: `locales/settings.ts` exports zh+en together, while
    // `locales/zh.ts` + `locales/en.ts` split the common pair across files.
    const perFile = new Map<string, Dictionary[]>()
    for (const file of files) {
      const dicts = dictionariesIn(file)
      if (dicts.length > 0) perFile.set(relative(file), dicts)
    }

    const groups = new Map<string, Map<'zh' | 'en', Dictionary>>()
    const place = (key: string, locale: 'zh' | 'en', dict: Dictionary): void => {
      const slot = groups.get(key) ?? new Map<'zh' | 'en', Dictionary>()
      if (slot.has(locale)) {
        throw new Error(`two ${locale} dictionaries claim pair ${key}: ${slot.get(locale)?.file} and ${dict.file}`)
      }
      slot.set(locale, dict)
      groups.set(key, slot)
    }

    for (const [rel, dicts] of perFile) {
      for (const dict of dicts) {
        const parsed = localeOf(dict.name)
        if (parsed === undefined) continue
        const sameFileCounterpart = dicts.some((other) => {
          const otherParsed = localeOf(other.name)
          return otherParsed !== undefined
            && otherParsed.pair === parsed.pair
            && otherParsed.locale !== parsed.locale
        })
        // Same-file pairs key by file so two pairs in one directory stay
        // distinct; split pairs key by directory so siblings meet.
        const key = sameFileCounterpart ? `${rel}::${parsed.pair}` : `${dirname(rel)}::${parsed.pair}`
        place(key, parsed.locale, dict)
      }
    }

    const problems: string[] = []
    let comparedPairs = 0
    for (const [key, slot] of [...groups].sort()) {
      const zh = slot.get('zh')
      const en = slot.get('en')
      if (zh === undefined || en === undefined) {
        const present = zh ?? en
        problems.push(`${present?.file} declares ${present?.name} with no counterpart for pair ${key}`)
        continue
      }
      comparedPairs++
      const zhOnly = zh.keys.filter(k => !en.keys.includes(k))
      const enOnly = en.keys.filter(k => !zh.keys.includes(k))
      if (zhOnly.length > 0) problems.push(`${zh.file} ${zh.name} has keys absent from ${en.name}: ${zhOnly.join(', ')}`)
      if (enOnly.length > 0) problems.push(`${en.file} ${en.name} has keys absent from ${zh.name}: ${enOnly.join(', ')}`)
    }

    // The shipped dictionary count only grows; a collapse means discovery or
    // pairing broke, which would hide real asymmetry.
    expect(comparedPairs).toBeGreaterThan(25)
    expect(problems).toEqual([])
  }, 30_000)
})
