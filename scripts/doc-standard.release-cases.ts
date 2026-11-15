/**
 * Session format release authority: the bilingual release record, the writer bound it may not exceed, and the tagged
 * evidence it must cite.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSON_SCHEMA, load } from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { readCurrentSessionFormatVersion } from './gen-session-format-catalog.ts'

const root = resolve(import.meta.dirname, '..')

interface SessionFormatRelease {
  latestReleasedVersion: number
  evidenceTag: string
}

/** Validate release metadata and tagged writer evidence; throw on malformed or inconsistent input. */
function validateSessionFormatRelease(source: string, currentWriterVersion: number): SessionFormatRelease {
  const normalized = source.replaceAll('\r\n', '\n')
  const openings = [...normalized.matchAll(/^```yaml session-format-release[ \t]*$/gmu)]
  if (openings.length !== 1) throw new Error('Expected exactly one session-format-release record')
  const block = /^```yaml session-format-release[ \t]*\n([\s\S]*?)^```[ \t]*$/mu.exec(normalized)
  if (block === null) throw new Error('Expected a closed session-format-release record')
  const metadata: unknown = load(block[1]!, { schema: JSON_SCHEMA })
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('Session format release record must be a mapping')
  }
  const fields = Object.keys(metadata).sort()
  if (fields.join(',') !== 'evidenceTag,latestReleasedVersion') {
    throw new Error('Session format release record requires exactly latestReleasedVersion and evidenceTag')
  }
  const { latestReleasedVersion, evidenceTag } = metadata as Record<string, unknown>
  if (typeof latestReleasedVersion !== 'number' || !Number.isSafeInteger(latestReleasedVersion)
    || latestReleasedVersion < 0) {
    throw new Error('latestReleasedVersion must be a non-negative safe integer')
  }
  if (latestReleasedVersion > currentWriterVersion) {
    throw new Error('latestReleasedVersion must not exceed the current writer version')
  }
  if (typeof evidenceTag !== 'string'
    || !/^dsh-v\d+\.\d+\.\d+(?:-[\dA-Za-z]+(?:[.-][\dA-Za-z]+)*)?(?:\+[\dA-Za-z]+(?:[.-][\dA-Za-z]+)*)?$/u.test(evidenceTag)) {
    throw new Error('evidenceTag must be a non-empty dsh-v version tag without URL delimiters')
  }
  const hasEvidence = normalized.split('\n').some(line =>
    line.includes(`\`${evidenceTag}\``) && line.includes('`packages/core/session/src/types.ts`'))
  if (!hasEvidence) throw new Error('Missing matching evidence tag and tagged writer path')
  return { latestReleasedVersion, evidenceTag }
}

function sessionFormatReleaseFixture(): { record: SessionFormatRelease; body: string; evidence: string; source: string } {
  const record = validateSessionFormatRelease(
    readFileSync(resolve(root, 'docs/session-format-status.md'), 'utf8'),
    readCurrentSessionFormatVersion(root),
  )
  const body = `latestReleasedVersion: ${record.latestReleasedVersion}\nevidenceTag: ${record.evidenceTag}`
  const evidence = `Evidence: published product tag \`${record.evidenceTag}\`; tagged writer: \`packages/core/session/src/types.ts\`.`
  return { record, body, evidence, source: releaseDocument(body, evidence) }
}

function releaseDocument(body: string, evidence: string): string {
  return `\`\`\`yaml session-format-release\n${body}\n\`\`\`\n\n${evidence}\n`
}

describe('Session format release authority', () => {
  it('keeps bilingual release metadata consistent with the writer and tagged evidence', () => {
    const records = ['docs/session-format-status.md', 'docs/session-format-status.zh.md'].map(file =>
      validateSessionFormatRelease(readFileSync(resolve(root, file), 'utf8'), readCurrentSessionFormatVersion(root)),
    )
    expect(records[0]).toEqual(records[1])
  })

  it('accepts a released writer and a newer development writer, including format zero', () => {
    const { record, body, evidence, source } = sessionFormatReleaseFixture()
    expect(validateSessionFormatRelease(source, record.latestReleasedVersion)).toEqual(record)
    expect(validateSessionFormatRelease(source, record.latestReleasedVersion + 1)).toEqual(record)
    const zero = releaseDocument(body.replace(`latestReleasedVersion: ${record.latestReleasedVersion}`, 'latestReleasedVersion: 0'), evidence)
    expect(validateSessionFormatRelease(zero, 0)).toEqual({ ...record, latestReleasedVersion: 0 })
  })

  it('rejects missing, duplicated, unclosed, and malformed release records', () => {
    const { record, body, evidence, source } = sessionFormatReleaseFixture()
    for (const invalid of [
      evidence,
      source + source,
      source + '\n```yaml session-format-release\n',
      `\`\`\`yaml session-format-release\n${body}`,
      releaseDocument('[unterminated', evidence),
      releaseDocument('', evidence),
      releaseDocument('null', evidence),
      releaseDocument('scalar', evidence),
      releaseDocument(`- latestReleasedVersion: ${record.latestReleasedVersion}`, evidence),
      releaseDocument(`${body}\n---\n${body}`, evidence),
    ]) {
      expect(() => validateSessionFormatRelease(invalid, record.latestReleasedVersion), invalid).toThrow()
    }
  })

  it('rejects missing, duplicate, and extra record fields', () => {
    const { record, body, evidence } = sessionFormatReleaseFixture()
    for (const invalid of [
      '{}',
      `evidenceTag: ${record.evidenceTag}`,
      `latestReleasedVersion: ${record.latestReleasedVersion}`,
      `${body}\nlatestReleasedVersion: ${record.latestReleasedVersion}`,
      `${body}\nevidenceTag: ${record.evidenceTag}`,
      `${body}\nreleased: true`,
    ]) {
      expect(() => validateSessionFormatRelease(releaseDocument(invalid, evidence), record.latestReleasedVersion), invalid).toThrow()
    }
  })

  it('rejects invalid released versions and releases beyond the current writer', () => {
    const { record, evidence } = sessionFormatReleaseFixture()
    for (const value of ['-1', '1.5', String(Number.MAX_SAFE_INTEGER + 1), '.inf', '.nan', 'null', 'true', '"0"']) {
      const source = releaseDocument(`latestReleasedVersion: ${value}\nevidenceTag: ${record.evidenceTag}`, evidence)
      expect(() => validateSessionFormatRelease(source, Number.MAX_SAFE_INTEGER), value).toThrow('non-negative safe integer')
    }
    const writer = readCurrentSessionFormatVersion(root)
    const future = releaseDocument(`latestReleasedVersion: ${writer + 1}\nevidenceTag: ${record.evidenceTag}`, evidence)
    expect(() => validateSessionFormatRelease(future, writer)).toThrow('must not exceed the current writer')
  })

  it('rejects empty, malformed, and URL-injecting evidence tags', () => {
    const { record, evidence } = sessionFormatReleaseFixture()
    for (const tag of [
      null, true, 1, '', ' ', 'dsh-v', record.evidenceTag.replace('dsh-v', 'v'),
      `${record.evidenceTag}/other`, `${record.evidenceTag}?query`, `${record.evidenceTag}#fragment`,
      `${record.evidenceTag}%2Fother`, `${record.evidenceTag})`, `${record.evidenceTag}\n`,
    ]) {
      const source = releaseDocument(`latestReleasedVersion: ${record.latestReleasedVersion}\nevidenceTag: ${JSON.stringify(tag)}`, evidence)
      expect(() => validateSessionFormatRelease(source, record.latestReleasedVersion), String(tag)).toThrow('dsh-v version tag')
    }
  })

  it('rejects absent or mismatched release tags and tagged writer paths', () => {
    const { record, body, evidence } = sessionFormatReleaseFixture()
    for (const invalid of [
      '',
      evidence.replace(record.evidenceTag, `${record.evidenceTag}-other`),
      evidence.replace(record.evidenceTag, 'main'),
      evidence.replace('packages/core/session/src/types.ts', 'packages/core/session/src/other.ts'),
      evidence.replace(record.evidenceTag, `${record.evidenceTag}?query`),
      evidence.replace('types.ts', 'types.ts#fragment'),
      evidence.replace('; tagged writer:', ';\n tagged writer:'),
    ]) {
      expect(() => validateSessionFormatRelease(releaseDocument(body, invalid), record.latestReleasedVersion), invalid)
        .toThrow('Missing matching evidence tag and tagged writer path')
    }
  })
})
