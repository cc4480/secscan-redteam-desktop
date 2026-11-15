/** License policy evaluation and the owner-authorized Claude distribution exception. */

import { describe, expect, it } from 'vitest'
import {
  CLAUDE_AGENT_SDK_PACKAGE,
  claudeDistributionFromManifest,
  isOwnerAuthorizedRuntime,
  isPermissive,
} from './gen-third-party-notices.ts'

describe('isPermissive', () => {
  it('accepts the licenses this project ships and rejects copyleft or unknown ones', () => {
    expect(['MIT', 'ISC', 'BSD-3-Clause', 'Apache-2.0', 'MIT / Apache-2.0', '(MIT OR CC0-1.0)'].every(isPermissive)).toBe(true)
    expect([
      'LGPL-3.0-only',
      'MPL-2.0',
      'GPL-3.0-or-later',
      'SEE LICENSE IN LICENSE',
      'SEE LICENSE IN README.md',
      'SEE LICENSE IN LICENSE.md',
    ].some(isPermissive)).toBe(false)
  })

  it('requires every operand of an AND, so a copyleft conjunct cannot ride along', () => {
    expect(isPermissive('(MIT OR Apache-2.0) AND GPL-3.0-only')).toBe(false)
    expect(isPermissive('MIT AND ISC')).toBe(true)
    // An exception clause is not a recognized identifier, so it fails closed.
    expect(isPermissive('GPL-2.0-only WITH Classpath-exception-2.0')).toBe(false)
  })

  it('honors grouping and SPDX precedence', () => {
    expect(isPermissive('MIT OR (GPL-3.0-only AND GPL-2.0-only)')).toBe(true)
    expect(isPermissive('(MIT OR Apache-2.0) AND ISC')).toBe(true)
  })

  it('fails closed for malformed expressions, additions, and exceptions', () => {
    expect(['MIT)', '((MIT', '(MIT OR GPL-3.0-only', 'MIT OR OR GPL-3.0-only'].some(isPermissive)).toBe(false)
    expect(isPermissive('MIT+')).toBe(false)
    expect(isPermissive('GPL-2.0-only WITH Classpath-exception-2.0')).toBe(false)
  })
})

describe('official Claude distribution authorization', () => {
  it('authorizes only the direct SDK identity without relabeling its license', () => {
    expect(isOwnerAuthorizedRuntime(CLAUDE_AGENT_SDK_PACKAGE)).toBe(true)
    expect(isOwnerAuthorizedRuntime(`${CLAUDE_AGENT_SDK_PACKAGE}-linux-x64`))
      .toBe(false)
    expect(isOwnerAuthorizedRuntime('@anthropic-ai/unrelated')).toBe(false)
    expect(isPermissive('SEE LICENSE IN README.md')).toBe(false)
  })

  it('derives version-independent platform payloads from the official SDK manifest', () => {
    expect(claudeDistributionFromManifest({
      name: CLAUDE_AGENT_SDK_PACKAGE,
      version: '9.8.7',
      license: 'future declared terms',
      claudeCodeVersion: '6.5.4',
      optionalDependencies: {
        [`${CLAUDE_AGENT_SDK_PACKAGE}-linux-x64`]: '9.8.7',
        [`${CLAUDE_AGENT_SDK_PACKAGE}-darwin-arm64`]: '9.8.7',
      },
    })).toEqual({
      sdkVersion: '9.8.7',
      claudeCodeVersion: '6.5.4',
      payloads: [
        {
          name: `${CLAUDE_AGENT_SDK_PACKAGE}-darwin-arm64`,
          version: '9.8.7',
        },
        {
          name: `${CLAUDE_AGENT_SDK_PACKAGE}-linux-x64`,
          version: '9.8.7',
        },
      ],
    })
  })

  it('rejects a wrong SDK identity, missing payloads, and unrelated optionals', () => {
    expect(() => claudeDistributionFromManifest({
      name: '@anthropic-ai/unrelated',
      version: '1.0.0',
      claudeCodeVersion: '1.0.0',
      optionalDependencies: {
        [`${CLAUDE_AGENT_SDK_PACKAGE}-linux-x64`]: '1.0.0',
      },
    })).toThrow(`expected ${CLAUDE_AGENT_SDK_PACKAGE} manifest`)
    expect(() => claudeDistributionFromManifest({
      name: CLAUDE_AGENT_SDK_PACKAGE,
      version: '1.0.0',
      claudeCodeVersion: '1.0.0',
    })).toThrow('declares no optional platform payloads')
    expect(() => claudeDistributionFromManifest({
      name: CLAUDE_AGENT_SDK_PACKAGE,
      version: '1.0.0',
      claudeCodeVersion: '1.0.0',
      optionalDependencies: {
        '@anthropic-ai/unrelated': '1.0.0',
      },
    })).toThrow('outside its authorized platform-payload identity')
  })
})
