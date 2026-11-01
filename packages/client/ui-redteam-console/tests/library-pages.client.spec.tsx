// @vitest-environment jsdom
/**
 * The Phase 3 pages over the real controllers with a scripted console:
 * Foundry state + a fired verify, Arsenal census → topic → search,
 * Reports rows with actions and honest gaps, Scope totals and latest.
 */
import { useSyncExternalStore } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { ArsenalPage } from '../src/client/ArsenalPage.tsx'
import type { ArsenalPageProps } from '../src/client/ArsenalPage.tsx'
import { createArsenalController, createReportsController } from '../src/client/arsenal-face.ts'
import { en } from '../src/client/locales.ts'
import { FoundryPage } from '../src/client/FoundryPage.tsx'
import type { FoundryPageProps } from '../src/client/FoundryPage.tsx'
import { createFoundryController, createScopeController } from '../src/client/foundry-face.ts'
import { ReportsPage } from '../src/client/ReportsPage.tsx'
import type { ReportsPageProps } from '../src/client/ReportsPage.tsx'
import { ScopePage } from '../src/client/ScopePage.tsx'
import type { ScopePageProps } from '../src/client/ScopePage.tsx'
import { scriptedConsole } from './fixtures.client.ts'

afterEach(() => { cleanup() })

/** Test-local selector hook over a framework-neutral store instance. */
function hookOf<T>(inst: { subscribe: (fn: () => void) => () => void; getSnapshot: () => T }) {
  return function useSelector<S>(sel: (s: T) => S): S {
    return sel(useSyncExternalStore(inst.subscribe, inst.getSnapshot))
  }
}

const t = makeTranslate(en)

function mountFoundry(): RenderResult {
  const controller = createFoundryController(scriptedConsole().api)
  const { face } = controller
  const props = {
    useFoundry: hookOf(face.hooks.foundry), start: face.start, stop: face.stop,
    refresh: face.refresh, act: face.act, t,
  }
  return render(<FoundryPage {...props as unknown as FoundryPageProps} />)
}

function mountArsenal(): RenderResult {
  const controller = createArsenalController(scriptedConsole().api)
  const { face } = controller
  const props = {
    useArsenal: hookOf(face.hooks.arsenal), start: face.start, stop: face.stop,
    browse: face.browse, search: face.search, recommend: face.recommend,
    clearResults: face.clearResults, t,
  }
  return render(<ArsenalPage {...props as unknown as ArsenalPageProps} />)
}

function mountReports(): RenderResult {
  const controller = createReportsController(scriptedConsole().api)
  const { face } = controller
  const props = {
    useReports: hookOf(face.hooks.reports), start: face.start, stop: face.stop,
    refresh: face.refresh, select: face.select, t,
  }
  return render(<ReportsPage {...props as unknown as ReportsPageProps} />)
}

function mountScope(): RenderResult {
  const controller = createScopeController(scriptedConsole().api)
  const { face } = controller
  const props = {
    useScope: hookOf(face.hooks.scope), start: face.start, stop: face.stop, refresh: face.refresh, t,
  }
  return render(<ScopePage {...props as unknown as ScopePageProps} />)
}

describe('phase 3 pages', () => {
  it('foundry shows state and a fired verify\'s totals', async () => {
    const view = mountFoundry()
    expect(await view.findByText('fixture-gold-1')).toBeTruthy()
    // The case id shows in the cases list and again in the fitness list.
    expect(view.getAllByText('case-fixture-1')).toHaveLength(2)
    fireEvent.click(view.getByText('Verify snapshot'))
    expect(await view.findByText('5/5 bundles ok')).toBeTruthy()
    expect(view.getByText('idor: 5/5')).toBeTruthy()
  })

  it('arsenal drills from census to a topic and searches', async () => {
    const view = mountArsenal()
    expect(await view.findByText('web')).toBeTruthy()
    fireEvent.click(view.getByText('web'))
    expect(await view.findByText('GTFOBins')).toBeTruthy()
    const input = view.getByLabelText('Search the index')
    fireEvent.change(input, { target: { value: 'idor' } })
    fireEvent.click(view.getByText('Search'))
    expect(await view.findByText('fixture-idor-entry')).toBeTruthy()
    expect(view.getByText(/1 results/)).toBeTruthy()
  })

  it('reports lists present files with actions and absent ones as gaps', async () => {
    const view = mountReports()
    expect(await view.findByText('report.md')).toBeTruthy()
    // Present text formats carry Copy; every present file carries Download.
    expect(view.getAllByText('Copy').length).toBeGreaterThanOrEqual(5)
    expect(view.getAllByText('Download').length).toBeGreaterThanOrEqual(5)
    // report.docx and report-package.zip are absent from the record: gaps.
    expect(view.getByText('report.docx')).toBeTruthy()
    expect(view.getByText('report-package.zip')).toBeTruthy()
    expect(view.getAllByText('Missing — not generated')).toHaveLength(2)
  })

  it('scope shows totals, halt reasons, and the latest event', async () => {
    const view = mountScope()
    expect(await view.findByText('2 engagements scanned')).toBeTruthy()
    expect(view.getByText('fixture halt reason ×1')).toBeTruthy()
    expect(view.getByText('tool_exec_denied')).toBeTruthy()
    expect(view.getByText(/denied: target outside engagement scope/)).toBeTruthy()
  })
})
