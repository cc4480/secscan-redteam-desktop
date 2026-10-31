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
  assembleCharterMessages,
  buildPhaseAnchor,
  defaultSoulPath,
  defaultSoulText,
  loadSoulText,
  soulAssetCandidates,
  type CharterEngagement,
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

const ENGAGEMENT: CharterEngagement = {
  engagementId: 'eng-2026-10-25-7f3a',
  owner: 'Acme Widgets LLC',
  proofMethod: 'DNS TXT record verified 2026-10-25',
  inScope: 'app.acme.example and api.acme.example',
}

const ANCHOR = buildPhaseAnchor({
  engagement: 'eng-2026-10-25-7f3a for Acme Widgets LLC',
  scope: 'app.acme.example',
  objective: 'validate the search parameter',
  artifact: 'a payload set with a negative control',
})

describe('SOUL in chartered assembly', () => {
  test('closes the system message, after charter, addendum, anchor, pack, and persona', () => {
    const assembled = assembleCharterMessages(
      ENGAGEMENT,
      'exploiter-operator',
      [
        { role: 'system', content: 'PERSONA-TEXT' },
        { role: 'user', content: 'Begin.' },
      ],
      { anchor: ANCHOR },
    )
    const system = assembled.messages[0]
    assert.equal(system.role, 'system')
    const soul = defaultSoulText()
    assert.ok(system.content.endsWith(soul), 'the SOUL text is the tail of the system message')
    const at = (needle: string) => system.content.indexOf(needle)
    assert.ok(at('You are an agent of SecScan RedTeam') === 0)
    assert.ok(at('Convert recon into PROVEN findings') > 0)
    assert.ok(at('Phase anchor (agent-generated for this phase)') > at('Convert recon into PROVEN findings'))
    assert.ok(at('Exemplar pack v1') > at('Phase anchor (agent-generated for this phase)'))
    assert.ok(at('PERSONA-TEXT') > at('Exemplar pack v1'))
    assert.ok(at(soul) > at('PERSONA-TEXT'))
    assert.equal(assembled.soulIncluded, true)
    assert.equal(assembled.anchorPresent, true)
    assert.equal(assembled.exemplarPackVersion, 1)
  })

  test('rides for every role, including pack-less roles with no persona text', () => {
    for (const role of ['coordinator', 'recon', 'reporter', 'exploiter-challenger'] as const) {
      const assembled = assembleCharterMessages(ENGAGEMENT, role, [{ role: 'user', content: 'Go.' }])
      assert.ok(assembled.messages[0].content.endsWith(defaultSoulText()), `SOUL missing for ${role}`)
      assert.equal(assembled.soulIncluded, true)
    }
  })

  test('adds its measured share to the assembly token accounting', () => {
    // The fallback path estimates context tokens as ceil(total content
    // chars / 4) over the assembled messages (charter/fallback.ts). The
    // SOUL's cost under that accounting is exactly the delta between the
    // assembled prompt and the same prompt with the final section cut.
    const estimate = (chars: number): number => Math.ceil(chars / 4)
    const task = [{ role: 'user', content: 'Begin.' }] as const
    const assembled = assembleCharterMessages(ENGAGEMENT, 'exploiter-operator', [...task], { anchor: ANCHOR })
    const system = assembled.messages[0].content
    const soul = defaultSoulText()
    const withoutSoul = system.slice(0, system.length - soul.length - '\n\n'.length)
    assert.ok(!withoutSoul.includes(soul))
    const restChars = task.reduce((sum, m) => sum + m.content.length, 0)
    const withTokens = estimate(system.length + restChars)
    const withoutTokens = estimate(withoutSoul.length + restChars)
    assert.ok(withTokens - withoutTokens > 0)
    // The delta is the SOUL section's size under the estimator, ±1 token of
    // rounding from the separator and the shared ceil.
    const soulTokens = estimate(soul.length)
    assert.ok(Math.abs(withTokens - withoutTokens - soulTokens) <= 1)
  })
})
