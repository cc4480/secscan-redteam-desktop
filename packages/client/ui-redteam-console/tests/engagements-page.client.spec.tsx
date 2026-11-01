// @vitest-environment jsdom
/**
 * The Engagements page over the real controller with a scripted console:
 * the list, the findings with proof on demand, coverage, the compliance
 * documents in their sandboxed frame (gaps shown as gaps), and the
 * reverify run from plan to verdict.
 */
import { useSyncExternalStore } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { EngagementsPage } from '../src/client/EngagementsPage.tsx'
import type { EngagementsPageProps } from '../src/client/EngagementsPage.tsx'
import { en } from '../src/client/locales.ts'
import { createEngagementsController } from '../src/client/panel-face.ts'
import type { EngagementsController } from '../src/client/panel-face.ts'
import { DONE_ENGAGEMENT, LIVE_ENGAGEMENT, scriptedConsole } from './fixtures.client.ts'
import type { ScriptedConsole } from './fixtures.client.ts'

afterEach(() => { cleanup() })

/** Test-local selector hook over a framework-neutral store instance. */
function hookOf<T>(inst: { subscribe: (fn: () => void) => () => void; getSnapshot: () => T }) {
  return function useSelector<S>(sel: (s: T) => S): S {
    return sel(useSyncExternalStore(inst.subscribe, inst.getSnapshot))
  }
}

interface Mounted {
  readonly view: RenderResult
  readonly scripted: ScriptedConsole
  readonly controller: EngagementsController
}

function mount(): Mounted {
  const scripted = scriptedConsole()
  const controller = createEngagementsController(scripted.api)
  const { face } = controller
  const props = {
    useEngagements: hookOf(face.hooks.engagements),
    start: face.start,
    stop: face.stop,
    refresh: face.refresh,
    select: face.select,
    loadProof: face.loadProof,
    planReverify: face.planReverify,
    executeReverify: face.executeReverify,
    t: makeTranslate(en),
  }
  const view = render(<EngagementsPage {...props as unknown as EngagementsPageProps} />)
  return { view, scripted, controller }
}

describe('EngagementsPage', () => {
  it('lists every engagement and shows the selected one\'s findings', async () => {
    const { view } = mount()
    // The id shows in the list row and again in the detail header.
    expect((await view.findAllByText(LIVE_ENGAGEMENT.id)).length).toBeGreaterThanOrEqual(2)
    expect(view.getByText(DONE_ENGAGEMENT.id)).toBeTruthy()
    expect(await view.findByText('Fixture: IDOR on the account endpoint')).toBeTruthy()
    expect(view.getByText('Fixture: missing rate limit on login')).toBeTruthy()
    expect(view.getByText('CVSS 7.5')).toBeTruthy()
    // Only the finding with a bundle offers proof.
    expect(view.getAllByText('View proof bundle')).toHaveLength(1)
  })

  it('expands the proof bundle: proves, does-not-prove, steps, canary', async () => {
    const { view } = mount()
    await view.findByText('Fixture: IDOR on the account endpoint')
    fireEvent.click(view.getByText('View proof bundle'))
    expect(await view.findByText(/returns another account's record/)).toBeTruthy()
    expect(view.getByText(/Write access or privilege escalation/)).toBeTruthy()
    expect(view.getByText('GET /api/accounts/2 (as account 1)')).toBeTruthy()
    expect(view.getAllByText('canary-fixture-1').length).toBeGreaterThan(0)
  })

  it('shows coverage cells, dispositions, and pending keys', async () => {
    const { view } = mount()
    await view.findByText('Fixture: IDOR on the account endpoint')
    fireEvent.click(view.getByText('Coverage'))
    expect(await view.findByText('A03:fixture-pending')).toBeTruthy()
    expect(view.getByText('Logic · covered')).toBeTruthy()
    expect(view.getByText('Validation · not covered')).toBeTruthy()
  })

  it('renders compliance documents in a sandboxed frame and gaps as gaps', async () => {
    const { view } = mount()
    await view.findByText('Fixture: IDOR on the account endpoint')
    fireEvent.click(view.getByText('Compliance'))
    const frame = await view.findByTitle('Evidence pack')
    expect(frame.getAttribute('sandbox')).toBe('')
    expect(frame.getAttribute('srcdoc')).toContain('Fixture evidence pack')
    fireEvent.click(view.getByText('Attestation'))
    expect(await view.findByText('Not written for this engagement')).toBeTruthy()
  })

  it('runs a reverify from plan to the job\'s verdict on the finding', async () => {
    const { view, scripted } = mount()
    await view.findByText('Fixture: IDOR on the account endpoint')
    fireEvent.click(view.getByText('Reverify'))
    const scope = await view.findByLabelText('Scope hosts (exact, comma-separated)') as HTMLInputElement
    expect(scope.value).toBe('fixture.invalid')
    expect(scripted.reverifies).toEqual([{ id: LIVE_ENGAGEMENT.id, finding: 'F-1' }])
    fireEvent.click(view.getByText('Execute reverify'))
    expect(await view.findByText(/Verdict: still-vulnerable/)).toBeTruthy()
    expect(scripted.reverifies[1]).toEqual({
      id: LIVE_ENGAGEMENT.id, finding: 'F-1', execute: true, scope: ['fixture.invalid'],
    })
  })
})
