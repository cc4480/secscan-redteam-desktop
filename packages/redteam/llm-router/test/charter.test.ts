/**
 * Shared Agent Charter loader: the charter is the fleet's authorization
 * frame, so assembly fails loud — a missing engagement field or an unknown
 * role throws instead of sending an agent out with a blank or wrong charter.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  CharterError,
  ROLE_ADDENDA,
  buildSystemPrompt,
  fillCharter,
  loadCharterText,
  roleAddendum,
  type CharterEngagement,
  type CharterRole,
} from '../src/charter/loader.js'

const FULL_ENGAGEMENT: CharterEngagement = {
  engagementId: 'eng-2026-10-25-7f3a',
  owner: 'Acme Widgets LLC',
  proofMethod: 'DNS TXT record verified 2026-10-25',
  inScope: 'app.acme.example and api.acme.example',
}

function brokenEngagement(field: keyof CharterEngagement, value: string | undefined): CharterEngagement {
  const record: CharterEngagement = { ...FULL_ENGAGEMENT }
  Object.assign(record, { [field]: value })
  return record
}

describe('loadCharterText', () => {
  test('loads the bundled charter asset', () => {
    const text = loadCharterText()
    assert.ok(text.startsWith('You are an agent of SecScan RedTeam'))
  })

  test('the bundled asset declares every engagement placeholder', () => {
    const text = loadCharterText()
    for (const placeholder of ['{{ENGAGEMENT_ID}}', '{{OWNER}}', '{{PROOF_METHOD}}', '{{IN_SCOPE}}']) {
      assert.ok(text.includes(placeholder), `asset is missing ${placeholder}`)
    }
  })

  test('throws CharterError for an unreadable asset path', () => {
    assert.throws(() => loadCharterText('/nonexistent/charter.md'), CharterError)
  })
})

describe('fillCharter', () => {
  test('substitutes every placeholder with the engagement values', () => {
    const filled = fillCharter(loadCharterText(), FULL_ENGAGEMENT)
    assert.ok(filled.includes(FULL_ENGAGEMENT.engagementId))
    assert.ok(filled.includes(FULL_ENGAGEMENT.owner))
    assert.ok(filled.includes(FULL_ENGAGEMENT.proofMethod))
    assert.ok(filled.includes(FULL_ENGAGEMENT.inScope))
    assert.ok(!filled.includes('{{'), 'no placeholder may survive filling')
  })

  for (const field of ['engagementId', 'owner', 'proofMethod', 'inScope'] as const) {
    test(`throws when ${field} is missing or empty`, () => {
      for (const bad of ['', '   ', undefined]) {
        assert.throws(
          () => fillCharter(loadCharterText(), brokenEngagement(field, bad)),
          (err: unknown) => err instanceof CharterError && err.message.includes(field),
        )
      }
    })
  }

  test('throws when the asset carries a placeholder with no matching field', () => {
    assert.throws(
      () => fillCharter('Charter {{ENGAGEMENT_ID}} plus {{MYSTERY_FIELD}}', FULL_ENGAGEMENT),
      CharterError,
    )
  })
})

describe('roleAddendum', () => {
  test('returns the pinned addendum for every known role', () => {
    for (const [role, addendum] of Object.entries(ROLE_ADDENDA)) {
      assert.equal(roleAddendum(role), addendum)
    }
  })

  test('throws CharterError for an unknown role', () => {
    assert.throws(() => roleAddendum('exploiter'), CharterError)
    assert.throws(() => roleAddendum(''), CharterError)
  })
})

describe('buildSystemPrompt', () => {
  test('places the filled charter before the role addendum', () => {
    const prompt = buildSystemPrompt(FULL_ENGAGEMENT, 'coordinator')
    const addendum = ROLE_ADDENDA.coordinator
    assert.ok(prompt.startsWith('You are an agent of SecScan RedTeam'))
    assert.ok(prompt.endsWith(addendum))
    assert.ok(prompt.indexOf(FULL_ENGAGEMENT.engagementId) < prompt.indexOf(addendum))
  })

  test('selects the correct addendum per role', () => {
    const distinctive: Record<CharterRole, string> = {
      coordinator: 'Own the plan and the gates',
      recon: 'Map the target completely',
      'exploiter-operator': 'Convert recon into PROVEN findings',
      'exploiter-challenger': 'Your job is to falsify',
      reporter: 'copy-paste remediation',
    }
    for (const [role, phrase] of Object.entries(distinctive)) {
      const prompt = buildSystemPrompt(FULL_ENGAGEMENT, role as CharterRole)
      assert.ok(prompt.includes(phrase), `${role} prompt is missing its addendum`)
      for (const [otherRole, otherPhrase] of Object.entries(distinctive)) {
        if (otherRole !== role) {
          assert.ok(!prompt.includes(otherPhrase), `${role} prompt leaked the ${otherRole} addendum`)
        }
      }
    }
  })

  test('throws CharterError for an unknown role', () => {
    const bogus: string = 'exploiter'
    assert.throws(() => buildSystemPrompt(FULL_ENGAGEMENT, bogus as CharterRole), CharterError)
  })

  test('throws CharterError when an engagement field is missing', () => {
    assert.throws(
      () => buildSystemPrompt(brokenEngagement('inScope', ''), 'recon'),
      CharterError,
    )
  })
})
