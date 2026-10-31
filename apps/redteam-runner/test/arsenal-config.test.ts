/**
 * Arsenal configuration (brief §1.6, spec §11).
 *
 * Pins the resolver contract: defaults and the §1.4 dbPath derivation, the
 * override winning over the derivation, blank env values counting as unset,
 * and every invalid value throwing at resolution with the exact variable
 * named — never default-and-continue.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_ARSENAL_MAX_ENTRIES_PER_COLLECTION,
  DEFAULT_ARSENAL_REFRESH_INTERVAL_HOURS,
  DEFAULT_ARSENAL_SOURCE_REPO,
  resolveArsenalConfig,
} from '../src/arsenal/config.js'

describe('arsenal config — defaults and derivation', () => {
  it('derives the db path from the engagements dir (desktop shape)', () => {
    const config = resolveArsenalConfig({}, { engagementsDir: '/data/engagements/live' })
    assert.equal(config.dbPath, '/data/arsenal/arsenal.db')
    assert.equal(config.arsenalDir, '/data/arsenal')
    assert.equal(config.cacheDir, '/data/arsenal/cache/awesome-hacking')
    assert.equal(config.enabled, true)
    assert.equal(config.sourceRepo, DEFAULT_ARSENAL_SOURCE_REPO)
    assert.equal(config.refreshIntervalHours, DEFAULT_ARSENAL_REFRESH_INTERVAL_HOURS)
    assert.equal(config.maxEntriesPerCollection, DEFAULT_ARSENAL_MAX_ENTRIES_PER_COLLECTION)
  })

  it('falls back to REDTEAM_HOME when no engagements dir is supplied', () => {
    const config = resolveArsenalConfig({ REDTEAM_HOME: '/srv/redteam' })
    assert.equal(config.dbPath, '/srv/redteam/arsenal/arsenal.db')
  })

  it('REDTEAM_ARSENAL_DB_PATH wins over the derivation', () => {
    const config = resolveArsenalConfig(
      { REDTEAM_ARSENAL_DB_PATH: '/elsewhere/custom.db' },
      { engagementsDir: '/data/engagements/live' },
    )
    assert.equal(config.dbPath, '/elsewhere/custom.db')
    assert.equal(config.arsenalDir, '/elsewhere')
    assert.equal(config.cacheDir, '/elsewhere/cache/awesome-hacking')
  })

  it('blank env values count as unset', () => {
    const config = resolveArsenalConfig(
      { REDTEAM_ARSENAL_DB_PATH: '  ', REDTEAM_ARSENAL_ENABLED: ' ' },
      { engagementsDir: '/data/engagements/live' },
    )
    assert.equal(config.dbPath, '/data/arsenal/arsenal.db')
    assert.equal(config.enabled, true)
  })
})

describe('arsenal config — validated fields fail loud, naming the variable', () => {
  it('enabled accepts only 0/1', () => {
    assert.equal(resolveArsenalConfig({ REDTEAM_ARSENAL_ENABLED: '0' }).enabled, false)
    assert.equal(resolveArsenalConfig({ REDTEAM_ARSENAL_ENABLED: '1' }).enabled, true)
    assert.throws(
      () => resolveArsenalConfig({ REDTEAM_ARSENAL_ENABLED: 'yes' }),
      /REDTEAM_ARSENAL_ENABLED/,
    )
  })

  it('refresh interval is an integer >= 0; 0 means manual only', () => {
    assert.equal(resolveArsenalConfig({ REDTEAM_ARSENAL_REFRESH_INTERVAL_HOURS: '0' }).refreshIntervalHours, 0)
    assert.equal(resolveArsenalConfig({ REDTEAM_ARSENAL_REFRESH_INTERVAL_HOURS: '24' }).refreshIntervalHours, 24)
    assert.throws(
      () => resolveArsenalConfig({ REDTEAM_ARSENAL_REFRESH_INTERVAL_HOURS: '-1' }),
      /REDTEAM_ARSENAL_REFRESH_INTERVAL_HOURS/,
    )
    assert.throws(
      () => resolveArsenalConfig({ REDTEAM_ARSENAL_REFRESH_INTERVAL_HOURS: '1.5' }),
      /REDTEAM_ARSENAL_REFRESH_INTERVAL_HOURS/,
    )
  })

  it('max entries per collection is an integer >= 1', () => {
    assert.equal(resolveArsenalConfig({ REDTEAM_ARSENAL_MAX_ENTRIES_PER_COLLECTION: '5' }).maxEntriesPerCollection, 5)
    assert.throws(
      () => resolveArsenalConfig({ REDTEAM_ARSENAL_MAX_ENTRIES_PER_COLLECTION: '0' }),
      /REDTEAM_ARSENAL_MAX_ENTRIES_PER_COLLECTION/,
    )
    assert.throws(
      () => resolveArsenalConfig({ REDTEAM_ARSENAL_MAX_ENTRIES_PER_COLLECTION: 'many' }),
      /REDTEAM_ARSENAL_MAX_ENTRIES_PER_COLLECTION/,
    )
  })

  it('source repo must be an https URL without credentials', () => {
    assert.equal(
      resolveArsenalConfig({ REDTEAM_ARSENAL_SOURCE_REPO: 'https://example.test/fork.git' }).sourceRepo,
      'https://example.test/fork.git',
    )
    assert.throws(
      () => resolveArsenalConfig({ REDTEAM_ARSENAL_SOURCE_REPO: 'http://example.test/fork.git' }),
      /REDTEAM_ARSENAL_SOURCE_REPO/,
    )
    assert.throws(
      () => resolveArsenalConfig({ REDTEAM_ARSENAL_SOURCE_REPO: 'https://user:secret@example.test/fork.git' }),
      /REDTEAM_ARSENAL_SOURCE_REPO/,
    )
    assert.throws(
      () => resolveArsenalConfig({ REDTEAM_ARSENAL_SOURCE_REPO: 'not a url' }),
      /REDTEAM_ARSENAL_SOURCE_REPO/,
    )
  })
})
