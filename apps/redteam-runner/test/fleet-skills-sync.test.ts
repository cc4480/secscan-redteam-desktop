/**
 * Fleet-skills drift guard — the fleet must be ONE set of instructions.
 *
 * The canonical prompt/skill tree lives in `packages/redteam/fleet-skills`.
 * The desktop ships a packaged copy under
 * `apps/desktop/resources/redteam-runner/node_modules/@secscan/redteam-fleet-skills`.
 * A seat reading a stale copy obeys a rule the source no longer states — the
 * exact way a contract silently stops binding. This test fails on divergence
 * rather than letting it surface as inconsistent agent behaviour.
 *
 * It skips (never passes silently) when the packaged tree is absent, so it is
 * honest on a machine that has not been packaged.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..', '..')
const sourceRoot = join(repoRoot, 'packages', 'redteam', 'fleet-skills')
const packagedRoot = join(
  repoRoot, 'apps', 'desktop', 'resources', 'redteam-runner',
  'node_modules', '@secscan', 'redteam-fleet-skills', 'lib', 'fleet-skills',
)

/** Every .md under the two trees that must be identical. Package metadata
 * (README.md, GAUNTLET.md) is deliberately not part of the runtime prompt set. */
function mdFiles(root: string, sub: string): string[] {
  const base = join(root, sub)
  if (!existsSync(base)) return []
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (name.endsWith('.md')) out.push(full)
    }
  }
  walk(base)
  return out
}

const sha = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex')

describe('fleet-skills drift', () => {
  const subtrees = ['prompts', 'skills']

  it('packaged tree matches the canonical source, file for file', (t) => {
    if (!existsSync(packagedRoot)) {
      t.skip('packaged fleet-skills tree absent on this machine')
      return
    }
    const problems: string[] = []
    for (const sub of subtrees) {
      for (const src of mdFiles(sourceRoot, sub)) {
        const rel = relative(sourceRoot, src)
        const pkg = join(packagedRoot, rel)
        if (!existsSync(pkg)) {
          problems.push(`missing in package: ${rel}`)
          continue
        }
        if (sha(src) !== sha(pkg)) problems.push(`diverged: ${rel}`)
      }
      // A file that exists ONLY in the package is a seat reading a rule the
      // source does not have.
      for (const pkg of mdFiles(packagedRoot, sub)) {
        const rel = relative(packagedRoot, pkg)
        if (!existsSync(join(sourceRoot, rel))) problems.push(`orphaned in package: ${rel}`)
      }
    }
    assert.deepEqual(problems, [], `fleet-skills drift detected:\n  ${problems.join('\n  ')}`)
  })

  it('the completeness rule is stated in the one contract every seat reads', () => {
    const master = readFileSync(join(sourceRoot, 'prompts', 'master.md'), 'utf8')
    assert.match(master, /COVERAGE HONESTY BINDS EVERY SURFACE/)
    assert.match(master, /report\/completeness\.ts/)
    assert.match(master, /absence of evidence/)
  })

  it('the HTML report skill carries the completeness rule', () => {
    const skill = readFileSync(join(sourceRoot, 'skills', 'html-report-design', 'SKILL.md'), 'utf8')
    assert.match(skill, /A posture verdict requires a concluded battery/)
    assert.match(skill, /report\/completeness\.ts/)
  })

  it('the reporter seat gates delivery on completeness, not only on design', () => {
    const seat = readFileSync(join(sourceRoot, 'prompts', 'seats', 'evaluator-reporter.md'), 'utf8')
    assert.match(seat, /coverage completeness/i)
    assert.match(seat, /posture not determined/)
  })
})
