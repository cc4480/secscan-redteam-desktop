/**
 * The SOUL asset and its place in chartered assembly. The SOUL is the
 * fleet's standing operating character: it loads fail-loud like the
 * charter (no SOUL, no run), its bytes are pinned by hash so an edit is a
 * deliberate act, and in the assembled system message it is the FINAL
 * section — behind the charter, the addendum, the anchor, the exemplar
 * pack, and any caller persona text.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  CharterError,
  SOUL_ASSET_SHA256,
  defaultSoulPath,
  defaultSoulText,
  loadSoulText,
  soulAssetCandidates,
} from '../src/index.js'

/**
 * SHA-256 of the served SOUL text. The loaders trim the asset (the charter
 * loaders' precedent), so the served text is the file's trimmed text; this
 * pin is that trimmed text's hash, computed once and recorded. The file
 * itself is pinned by SOUL_ASSET_SHA256.
 */
const SOUL_TEXT_SHA256 = '5ae99c58a999a1547aae89334d4538ac2d7a217233bfdf478a159223e751fdc0'

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

describe('SOUL loader', () => {
  test('loads the bundled SOUL and serves the pinned text', () => {
    const text = loadSoulText()
    assert.equal(sha256(text), SOUL_TEXT_SHA256)
    assert.equal(defaultSoulText(), text)
  })

  test('the bundled asset file matches the pinned asset hash', () => {
    const fileText = readFileSync(defaultSoulPath(), 'utf8')
    assert.equal(sha256(fileText), SOUL_ASSET_SHA256)
  })

  test('resolves the vendored-payload candidate first, then beside the module', () => {
    // The compiled SOUL module sits at dist-test/src/charter/, one level up
    // from this test; the candidate chain is built from that directory.
    const moduleDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'charter')
    const candidates = soulAssetCandidates()
    assert.equal(candidates[0], join(moduleDir, 'charter', 'soul.md'))
    assert.equal(candidates[1], join(moduleDir, 'soul.md'))
  })

  test('throws CharterError for an unreadable SOUL path', () => {
    assert.throws(() => loadSoulText('/nonexistent/soul.md'), CharterError)
  })
})
