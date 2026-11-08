/**
 * Provider universality — the fleet vocabulary: every registered
 * family seats its own table when selected, a saved pick of any family
 * maps to that family (never silently to DeepSeek), an unknown
 * explicit selector fails loud at selection time, and DeepSeek remains
 * the unset default.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  effectiveFleetProvider,
  fleetProviderFamilyForProvider,
} from '../src/fleet-provider-record.js'
import { LLM_PROVIDER_ENV, roleModelPolicy } from '../src/policy.js'

const FAMILIES = ['deepseek', 'meta', 'qwen', 'openai', 'anthropic', 'xai', 'zai', 'gemini'] as const

describe('roleModelPolicy — one seat table per family', () => {
  it('seats DeepSeek when the selector is unset', () => {
    const policy = roleModelPolicy({})
    for (const route of Object.values(policy)) assert.equal(route.provider, 'deepseek')
  })

  for (const family of FAMILIES) {
    it(`seats ${family} on every role when ${family} is selected`, () => {
      const policy = roleModelPolicy({ [LLM_PROVIDER_ENV]: family })
      for (const [role, route] of Object.entries(policy)) {
        assert.equal(route.provider, family, `role ${role} must route to ${family}`)
      }
    })
  }

  it('gives the exploiter the family’s strongest reasoner', () => {
    assert.equal(roleModelPolicy({ [LLM_PROVIDER_ENV]: 'openai' }).exploiter.model, 'gpt-5.5')
    assert.equal(roleModelPolicy({ [LLM_PROVIDER_ENV]: 'anthropic' }).exploiter.model, 'claude-opus-5-5')
    assert.equal(roleModelPolicy({ [LLM_PROVIDER_ENV]: 'xai' }).exploiter.model, 'grok-4.7')
    assert.equal(roleModelPolicy({ [LLM_PROVIDER_ENV]: 'zai' }).exploiter.model, 'glm-5.3')
    assert.equal(roleModelPolicy({ [LLM_PROVIDER_ENV]: 'gemini' }).exploiter.model, 'gemini-3.1-pro-preview')
    assert.equal(roleModelPolicy({ [LLM_PROVIDER_ENV]: 'qwen' }).exploiter.model, 'qwen3.8-max')
  })

  it('resolves the chat-route aliases to their own families', () => {
    assert.equal(roleModelPolicy({ [LLM_PROVIDER_ENV]: 'google' }).coordinator.provider, 'gemini')
    assert.equal(roleModelPolicy({ [LLM_PROVIDER_ENV]: 'deepseek-official' }).coordinator.provider, 'deepseek')
  })

  it('fails loud on a selector that names no fleet family — never a silent DeepSeek conversion', () => {
    assert.throws(
      () => roleModelPolicy({ [LLM_PROVIDER_ENV]: 'groq' }),
      /names 'groq', which is not a fleet provider/,
    )
    assert.throws(
      () => roleModelPolicy({ [LLM_PROVIDER_ENV]: 'not-a-provider' }),
      /not a fleet provider/,
    )
  })

  it('still requires a model name for the local family', () => {
    assert.throws(() => roleModelPolicy({ [LLM_PROVIDER_ENV]: 'local' }), /requires REDTEAM_LOCAL_MODEL/)
    const policy = roleModelPolicy({ [LLM_PROVIDER_ENV]: 'local', REDTEAM_LOCAL_MODEL: 'm.gguf' })
    for (const route of Object.values(policy)) assert.equal(route.provider, 'local')
  })
})

describe('fleetProviderFamilyForProvider — the saved-pick map', () => {
  it('names every fleet family by its own id', () => {
    for (const family of FAMILIES) assert.equal(fleetProviderFamilyForProvider(family), family)
    assert.equal(fleetProviderFamilyForProvider('local'), 'local')
  })

  it('maps chat-route ids and aliases to the SAME provider’s family', () => {
    assert.equal(fleetProviderFamilyForProvider('deepseek-official'), 'deepseek')
    assert.equal(fleetProviderFamilyForProvider('google'), 'gemini')
    assert.equal(fleetProviderFamilyForProvider('glm'), 'zai')
    assert.equal(fleetProviderFamilyForProvider('grok'), 'xai')
    assert.equal(fleetProviderFamilyForProvider('claude'), 'anthropic')
  })

  it('names no family for a chat-only provider or a blank id — no substitution', () => {
    assert.equal(fleetProviderFamilyForProvider('groq'), undefined)
    assert.equal(fleetProviderFamilyForProvider('openrouter'), undefined)
    assert.equal(fleetProviderFamilyForProvider(''), undefined)
    assert.equal(fleetProviderFamilyForProvider(undefined), undefined)
    assert.equal(fleetProviderFamilyForProvider('  '), undefined)
  })
})

describe('effectiveFleetProvider — the desktop’s publication computation', () => {
  it('an explicit family names itself and beats a serving local server', () => {
    assert.equal(effectiveFleetProvider('anthropic', true), 'anthropic')
    assert.equal(effectiveFleetProvider('qwen', false), 'qwen')
    assert.equal(effectiveFleetProvider('openai', false), 'openai')
    assert.equal(effectiveFleetProvider('local', false), 'local')
  })

  it('an explicit value naming no fleet family throws instead of converting to DeepSeek', () => {
    assert.throws(() => effectiveFleetProvider('groq', false), /not a fleet provider/)
  })

  it('with no explicit value, local serving wins, then the saved pick’s family, then DeepSeek', () => {
    assert.equal(effectiveFleetProvider(undefined, true), 'local')
    assert.equal(effectiveFleetProvider(undefined, false, 'anthropic'), 'anthropic')
    assert.equal(effectiveFleetProvider(undefined, false, 'google'), 'gemini')
    assert.equal(effectiveFleetProvider(undefined, false, 'deepseek-official'), 'deepseek')
    // A saved pick with no fleet family (chat-only provider) names no
    // fleet selection: the record states the DeepSeek default, exactly
    // as it does for an operator who never picked.
    assert.equal(effectiveFleetProvider(undefined, false, 'groq'), 'deepseek')
    assert.equal(effectiveFleetProvider(undefined, false), 'deepseek')
    assert.equal(effectiveFleetProvider('', false), 'deepseek')
  })
})
