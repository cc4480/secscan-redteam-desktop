/**
 * What the Engagements panel keeps: the list, the selection, and the
 * selected engagement's record sections (findings, coverage, compliance),
 * with proof bundles and reverify runs tracked per finding.
 *
 * One instance serves the panel (root scope — the panel belongs to the
 * profile, not to a session). Sections belong to the selection: selecting
 * another engagement clears them, and the face reloads; a stale section
 * from a previous selection is never shown under a new one.
 */
import { defineStore } from '@deepseek-ai/dsh-client-store'
import type { Compliance, Coverage, Finding, ProofBundle, ReverifyPlan } from './engagements-model.ts'
import type { ListState } from './store.ts'

export type { ListState }

/** One record section's load state. */
export type SectionState<T> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly value: T }
  | { readonly kind: 'failed'; readonly message: string }

/** One finding's reverify run, from first plan to the job's verdict. */
export type ReverifyState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'planning' }
  | { readonly kind: 'plan'; readonly plan: ReverifyPlan }
  | { readonly kind: 'executing'; readonly jobId: string }
  | { readonly kind: 'done'; readonly verdict: string | undefined; readonly summary: string | undefined }
  | { readonly kind: 'failed'; readonly message: string }

/** The three record sections, by name. */
export type SectionName = 'findings' | 'coverage' | 'compliance'

/** The panel's whole state. */
export interface EngagementsState {
  list: ListState
  selectedId: string | undefined
  findings: SectionState<readonly Finding[]> | undefined
  coverage: SectionState<Coverage> | undefined
  compliance: SectionState<Compliance> | undefined
  proofByFinding: Record<string, SectionState<ProofBundle>>
  reverifyByFinding: Record<string, ReverifyState>
}

/** Store factory for the Engagements panel's state. */
export function createEngagementsStore() {
  return defineStore<EngagementsState, {
    listLoading: (draft: EngagementsState) => void
    listLoaded: (draft: EngagementsState, engagements: ListState) => void
    listFailed: (draft: EngagementsState, message: string) => void
    select: (draft: EngagementsState, id: string | undefined) => void
    sectionLoading: (draft: EngagementsState, name: SectionName) => void
    findingsLoaded: (draft: EngagementsState, value: readonly Finding[]) => void
    coverageLoaded: (draft: EngagementsState, value: Coverage) => void
    complianceLoaded: (draft: EngagementsState, value: Compliance) => void
    sectionFailed: (draft: EngagementsState, name: SectionName, message: string) => void
    proofLoading: (draft: EngagementsState, findingId: string) => void
    proofLoaded: (draft: EngagementsState, findingId: string, value: ProofBundle) => void
    proofFailed: (draft: EngagementsState, findingId: string, message: string) => void
    reverifySet: (draft: EngagementsState, findingId: string, state: ReverifyState) => void
  }>({
    init: (): EngagementsState => ({
      list: { kind: 'loading' },
      selectedId: undefined,
      findings: undefined,
      coverage: undefined,
      compliance: undefined,
      proofByFinding: {},
      reverifyByFinding: {},
    }),
    actions: {
      listLoading: (d) => { d.list = { kind: 'loading' } },
      listLoaded: (d, engagements) => { d.list = engagements },
      listFailed: (d, message) => { d.list = { kind: 'failed', message } },
      select: (d, id) => {
        if (d.selectedId === id) return
        d.selectedId = id
        d.findings = undefined
        d.coverage = undefined
        d.compliance = undefined
        d.proofByFinding = {}
        d.reverifyByFinding = {}
      },
      sectionLoading: (d, name) => { d[name] = { kind: 'loading' } },
      findingsLoaded: (d, value) => { d.findings = { kind: 'ready', value } },
      coverageLoaded: (d, value) => { d.coverage = { kind: 'ready', value } },
      complianceLoaded: (d, value) => { d.compliance = { kind: 'ready', value } },
      sectionFailed: (d, name, message) => { d[name] = { kind: 'failed', message } },
      proofLoading: (d, findingId) => {
        d.proofByFinding = { ...d.proofByFinding, [findingId]: { kind: 'loading' } }
      },
      proofLoaded: (d, findingId, value) => {
        d.proofByFinding = { ...d.proofByFinding, [findingId]: { kind: 'ready', value } }
      },
      proofFailed: (d, findingId, message) => {
        d.proofByFinding = { ...d.proofByFinding, [findingId]: { kind: 'failed', message } }
      },
      reverifySet: (d, findingId, state) => {
        d.reverifyByFinding = { ...d.reverifyByFinding, [findingId]: state }
      },
    },
  })
}
