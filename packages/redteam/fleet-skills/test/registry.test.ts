/**
 * Fleet skill registry: discovery, shadowing, loading, and the Layer-1
 * index block, exercised against the bundled skills and synthetic roots.
 * All local — no network, no model calls.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { parseSkillFrontmatter } from '../src/frontmatter.js'
import { bundledSkillsRoot, discoverSkills, loadSkillBody, skillIndexBlock } from '../src/registry.js'

const BUNDLED_NAMES = [
  'blackteam-adversary-emulation',
  'browser-action-execution',
  'deep-research-osint',
  'exploit-coding-toolbuilding',
  'findings-grading-reporting',
  'html-report-design',
  'redteam-ops-coordination',
  'webapp-exploit',
  'webapp-scan',
]

function writeSkill(root: string, name: string, description: string): void {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: "${description}"\n---\n\n# ${name}\n`)
}

describe('discoverSkills over the bundled root', () => {
  test('finds all 9 bundled skills via bundledSkillsRoot()', () => {
    const metas = discoverSkills([bundledSkillsRoot()])
    assert.deepEqual(
      metas.map(meta => meta.name).sort(),
      [...BUNDLED_NAMES].sort(),
    )
    for (const meta of metas) {
      assert.ok(meta.description.length > 0, `${meta.name} has a description`)
      assert.equal(meta.dir, join(bundledSkillsRoot(), meta.name))
      assert.equal(meta.skillFile, join(meta.dir, 'SKILL.md'))
    }
  })

  test('forced load returns the full body containing the frontmatter name', () => {
    const metas = discoverSkills([bundledSkillsRoot()])
    for (const meta of metas) {
      const body = loadSkillBody(meta)
      assert.ok(body.includes(`name: ${meta.name}`), `${meta.name} body carries its frontmatter name`)
      assert.ok(body.length > meta.description.length, `${meta.name} body is more than its description`)
    }
  })

  test('index block contains all 9 names under the fleet_skills_index header', () => {
    const block = skillIndexBlock(discoverSkills([bundledSkillsRoot()]))
    assert.ok(block.startsWith('<fleet_skills_index>'))
    assert.ok(block.trimEnd().endsWith('</fleet_skills_index>'))
    for (const name of BUNDLED_NAMES) {
      assert.ok(block.includes(`- ${name}:`), `index block lists ${name}`)
    }
  })
})

describe('discoverSkills shadowing', () => {
  test('an earlier root shadows a later root carrying the same skill name', () => {
    const base = mkdtempSync(join(tmpdir(), 'fleet-skills-shadow-'))
    try {
      const earlier = join(base, 'earlier')
      const later = join(base, 'later')
      writeSkill(earlier, 'webapp-scan', 'earlier copy wins')
      writeSkill(later, 'webapp-scan', 'later copy is shadowed')
      writeSkill(later, 'webapp-exploit', 'only in the later root')
      const metas = discoverSkills([earlier, later])
      assert.equal(metas.length, 2)
      const scan = metas.find(meta => meta.name === 'webapp-scan')
      assert.ok(scan)
      assert.equal(scan.description, 'earlier copy wins')
      assert.equal(scan.dir, join(earlier, 'webapp-scan'))
      assert.ok(metas.some(meta => meta.name === 'webapp-exploit'))
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})

describe('parseSkillFrontmatter', () => {
  test('rejects a skill whose frontmatter has no description', () => {
    assert.throws(
      () => parseSkillFrontmatter('---\nname: webapp-scan\n---\n\n# No description\n'),
      /description/,
    )
  })

  test('rejects a skill whose frontmatter has no name', () => {
    assert.throws(
      () => parseSkillFrontmatter('---\ndescription: "present"\n---\n'),
      /name/,
    )
  })

  test('rejects a name that is not kebab-case', () => {
    assert.throws(
      () => parseSkillFrontmatter('---\nname: Webapp_Scan\ndescription: "present"\n---\n'),
      /kebab-case/,
    )
  })
})
