// @vitest-environment jsdom
/**
 * Q-DOC-ACTIONS — the engagement-report document card: the result model
 * (presence from the named path fields, gaps from the deliverableGap
 * sentence or an unnamed file), the on-demand actions (Copy places the
 * file's exact content on the clipboard; Download HEAD-probes the share
 * route, then hands it to the browser download manager), and the
 * rendered rows (binary formats download-only, gaps with no buttons).
 */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import {
  createEngagementDocumentActions, engagementDocumentsFromResult,
  type EngagementDocumentActions,
} from '../src/client/engagement-documents.ts'
import { EngagementReportRow } from '../src/client/EngagementReportRow.tsx'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const ID = 'eng-2026-11-01-fixture1'
const MD_CONTENT = '# Fixture report\n\nOne finding.\n'

function resultBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ID,
    ready: true,
    reportPath: `/engagements/${ID}/report.md`,
    reportHtmlPath: `/engagements/${ID}/report.html`,
    reportJsonPath: `/engagements/${ID}/report.json`,
    reportTxtPath: `/engagements/${ID}/report.txt`,
    findingsCsvPath: `/engagements/${ID}/findings.csv`,
    reportDocxPath: `/engagements/${ID}/report.docx`,
    reportPackagePath: `/engagements/${ID}/report-package.zip`,
    content: MD_CONTENT,
    summary: 'Report ready.',
    ...overrides,
  }
}

describe('engagementDocumentsFromResult', () => {
  it('maps the full named set to present documents, binary formats not copyable', () => {
    const report = engagementDocumentsFromResult(JSON.stringify(resultBody()))
    expect(report?.id).toBe(ID)
    expect(report?.documents.map(d => [d.file, d.present, d.copyable])).toEqual([
      ['report.html', true, true],
      ['report.md', true, true],
      ['report.json', true, true],
      ['report.txt', true, true],
      ['findings.csv', true, true],
      ['report.docx', true, false],
      ['report-package.zip', true, false],
    ])
  })

  it('renders the deliverableGap sentence names and unnamed files as gaps', () => {
    const body = resultBody({
      reportHtmlPath: undefined,
      reportTxtPath: undefined,
      findingsCsvPath: undefined,
      deliverableGap: 'report.html is missing from the engagement directory — the deliverable set is incomplete (missing: report.html, report.txt); see the run\'s deliverable_failed record.',
    })
    const report = engagementDocumentsFromResult(JSON.stringify(body))
    const byFile = new Map(report?.documents.map(d => [d.file, d.present]))
    expect(byFile.get('report.html')).toBe(false)
    expect(byFile.get('report.txt')).toBe(false)
    // findings.csv is named nowhere and no gap field covers it in the
    // real tool either (gap fires only for report.html) — still a gap.
    expect(byFile.get('findings.csv')).toBe(false)
    expect(byFile.get('report.md')).toBe(true)
    expect(byFile.get('report.docx')).toBe(true)
  })

  it('declines results that are not a ready report', () => {
    expect(engagementDocumentsFromResult(JSON.stringify(resultBody({ ready: false })))).toBeNull()
    expect(engagementDocumentsFromResult('not json')).toBeNull()
    expect(engagementDocumentsFromResult(JSON.stringify({ ready: true, id: ID }))).toBeNull()
  })
})

describe('createEngagementDocumentActions', () => {
  it('copy places the file\'s exact content on the clipboard', async () => {
    const written: string[] = []
    vi.stubGlobal('fetch', vi.fn(async () => new Response(MD_CONTENT, { status: 200 })))
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => { written.push(text) } },
    })
    const actions = createEngagementDocumentActions(ID)
    await expect(actions.copy('report.md')).resolves.toBe(MD_CONTENT)
    expect(written).toEqual([MD_CONTENT])
  })

  it('copy refuses binary formats without fetching', async () => {
    const fetcher = vi.fn(async () => new Response('x', { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    const actions = createEngagementDocumentActions(ID)
    await expect(actions.copy('report.docx')).resolves.toBeNull()
    await expect(actions.copy('report-package.zip')).resolves.toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('download HEAD-probes the share route, then hands it to the download manager', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    const clicks: { href: string; download: string }[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ href: this.getAttribute('href') ?? '', download: this.download })
    })
    const actions = createEngagementDocumentActions(ID)
    await expect(actions.download('report.docx')).resolves.toBe(true)
    expect(fetcher).toHaveBeenCalledWith(
      `redteam-console/api/engagements/${ID}/deliverables/report.docx`, { method: 'HEAD' },
    )
    expect(clicks).toEqual([{
      href: `redteam-console/api/engagements/${ID}/deliverables/report.docx`,
      download: 'report.docx',
    }])
  })

  it('download reports a failed probe and hands nothing off', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const actions = createEngagementDocumentActions(ID)
    await expect(actions.download('report.txt')).resolves.toBe(false)
    expect(click).not.toHaveBeenCalled()
  })
})

function settledRow(actions: EngagementDocumentActions, body: Record<string, unknown>) {
  const block: ToolResultNode = {
    kind: 'tool-result', seq: 2, time: 2, callId: 'r',
    call: { name: 'mcp__redteam__engagement_report', argsRaw: JSON.stringify({ id: ID }) },
    callTime: 1, content: [{ type: 'text', text: JSON.stringify(body) }], isError: false, subCalls: [],
  }
  const props = {
    phase: 'result' as const, block, callId: 'r', toolName: 'mcp__redteam__engagement_report',
    openFile: vi.fn(), t: makeTranslate(en), actions,
  }
  return render(createElement(EngagementReportRow, props as never))
}

describe('EngagementReportRow', () => {
  it('renders every document with its actions; the gap row has none', async () => {
    const actions: EngagementDocumentActions = {
      download: vi.fn(async () => true),
      copy: vi.fn(async () => MD_CONTENT),
    }
    const body = resultBody({
      reportTxtPath: undefined,
      deliverableGap: 'report.html is missing from the engagement directory — the deliverable set is incomplete (missing: report.txt); see the run\'s deliverable_failed record.',
    })
    const view = settledRow(actions, body)
    const rows = view.container.querySelectorAll('[data-document]')
    expect([...rows].map(row => row.getAttribute('data-document'))).toEqual([
      'report.html', 'report.md', 'report.json', 'report.txt', 'findings.csv', 'report.docx', 'report-package.zip',
    ])
    const gap = view.container.querySelector('[data-document="report.txt"]')
    expect(gap?.hasAttribute('data-gap')).toBe(true)
    expect(gap?.querySelectorAll('button')).toHaveLength(0)
    expect(gap?.textContent).toContain('Missing — not generated')

    const docx = view.container.querySelector('[data-document="report.docx"]')
    expect(docx?.textContent).toContain('Binary file — download only')
    expect(view.getByRole('button', { name: 'Download report.docx' })).toBeTruthy()
    expect(view.queryByRole('button', { name: 'Copy report.docx' })).toBeNull()
    expect(view.getByRole('button', { name: 'Download all files report-package.zip' })).toBeTruthy()

    fireEvent.click(view.getByRole('button', { name: 'Copy report.md' }))
    await waitFor(() => { expect(actions.copy).toHaveBeenCalledWith('report.md') })
    await waitFor(() => { expect(view.getByRole('button', { name: 'Copied' })).toBeTruthy() }, { timeout: 3000 })
    fireEvent.click(view.getByRole('button', { name: 'Download report.html' }))
    await waitFor(() => { expect(actions.download).toHaveBeenCalledWith('report.html') })
  }, 20000)

  it('shows a failure note when an action fails, and no documents before ready', async () => {
    const actions: EngagementDocumentActions = {
      download: vi.fn(async () => false),
      copy: vi.fn(async () => null),
    }
    const view = settledRow(actions, resultBody())
    fireEvent.click(view.getByRole('button', { name: 'Download report.html' }))
    await waitFor(() => { expect(view.getByText('Download failed. Try again.')).toBeTruthy() })
    view.rerender(createElement(EngagementReportRow, {
      phase: 'result',
      block: {
        kind: 'tool-result', seq: 3, time: 3, callId: 'r',
        call: { name: 'mcp__redteam__engagement_report', argsRaw: '{}' },
        callTime: 1, content: [{ type: 'text', text: JSON.stringify({ id: ID, ready: false, status: 'running' }) }],
        isError: false, subCalls: [],
      },
      callId: 'r', toolName: 'mcp__redteam__engagement_report', openFile: vi.fn(), t: makeTranslate(en), actions,
    } as never))
    expect(view.container.querySelector('[data-engagement-documents]')).toBeNull()
  })
})
