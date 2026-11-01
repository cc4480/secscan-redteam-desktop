/**
 * The findings section: every confirmed finding as a card — severity,
 * status and cell verdict, CVSS/CWE, evidence, fix, retest — with its
 * proof bundle on demand and its reverify run.
 *
 * The proof view shows the bundle's own accounting: what it proves, what
 * it does NOT prove, the canary markers, and the executed steps. Reverify
 * is a per-finding action on the console's job flow (plan → execute →
 * verdict), never a standalone page.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './locales.ts'
import type { Finding, ProofBundle } from './engagements-model.ts'
import type { ReverifyState, SectionState } from './panel-store.ts'
import css from './EngagementsPage.module.css'

/** Severity → its accent class (critical/high hot, medium warm, rest cool). */
const SEVERITY_CLASS: Record<Finding['severity'], string> = {
  critical: 'sev_critical',
  high: 'sev_high',
  medium: 'sev_medium',
  low: 'sev_low',
  info: 'sev_info',
}

/** The scope prefill: the target's host part, as the console enforces exact hosts. */
function hostOf(target: string): string {
  try {
    return new URL(target).hostname
  } catch {
    return target.replace(/^\*\./, '').split('/')[0] ?? target
  }
}

/** One proof bundle, expanded under its finding. */
function ProofView({ bundle, t }: { bundle: ProofBundle; t: TranslateNS<'redteamConsole'> }): ReactNode {
  return (
    <div className={css.proof}>
      <div className={css.proofBlock}>
        <h5>{t('proof.proves')}</h5>
        <p>{bundle.proves}</p>
      </div>
      <div className={css.proofBlock}>
        <h5>{t('proof.doesNotProve')}</h5>
        <p>{bundle.doesNotProve}</p>
      </div>
      <dl className={css.kv}>
        <div className={css.kvRow}>
          <dt>{t('proof.tier')}</dt>
          <dd>{bundle.validationTier}</dd>
        </div>
        {bundle.markerSent !== undefined && (
          <div className={css.kvRow}>
            <dt>{t('proof.markerSent')}</dt>
            <dd className={css.mono}>{bundle.markerSent}</dd>
          </div>
        )}
        {bundle.markerObserved !== undefined && (
          <div className={css.kvRow}>
            <dt>{t('proof.markerObserved')}</dt>
            <dd className={css.mono}>{bundle.markerObserved}</dd>
          </div>
        )}
      </dl>
      <h5 className={css.subTitle}>{`${t('proof.steps')} (${bundle.steps.length})`}</h5>
      <ol className={css.stepList}>
        {bundle.steps.map(step => (
          <li key={step.seq} className={css.stepRow}>
            <span className={css.mono}>{`#${step.seq}`}</span>
            <span className={css.mono}>{step.tool}</span>
            <span className={css.stepCommand}>{step.command}</span>
            <span className={css.stepResult}>{step.result}</span>
          </li>
        ))}
      </ol>
      <div className={css.proofBlock}>
        <h5>{t('proof.reverifyCommand')}</h5>
        <p className={css.mono}>{bundle.reverifyCommand}</p>
      </div>
    </div>
  )
}

/** The reverify callbacks the section drives. */
export interface ReverifyCallbacks {
  /** Fetch one finding's proof bundle. */
  loadProof(findingId: string): void
  /** Ask the console for a reverify plan (no traffic). */
  planReverify(findingId: string): void
  /** Execute the reverify job against the scope hosts. */
  executeReverify(findingId: string, scope: readonly string[]): void
}

/** One finding's reverify run: plan (no traffic) → execute (job) → verdict. */
function ReverifyBlock({ finding, state, target, face, t }: {
  finding: Finding
  state: ReverifyState | undefined
  target: string
  face: ReverifyCallbacks
  t: TranslateNS<'redteamConsole'>
}): ReactNode {
  const [scope, setScope] = useState<string | undefined>(undefined)
  if (state === undefined || state.kind === 'idle') {
    return (
      <button type="button" className={css.button} onClick={() => { face.planReverify(finding.id) }}>
        {t('reverify.button')}
      </button>
    )
  }
  if (state.kind === 'planning') return <p className={css.note}>{t('reverify.planning')}</p>
  if (state.kind === 'failed') {
    return (
      <div>
        <p className={css.errorLine}>{t('reverify.failed', { message: state.message })}</p>
        <button type="button" className={css.button} onClick={() => { face.planReverify(finding.id) }}>
          {t('reverify.button')}
        </button>
      </div>
    )
  }
  if (state.kind === 'executing') return <p className={css.note}>{t('reverify.executing')}</p>
  if (state.kind === 'done') {
    return (
      <p className={css.note}>
        {`${t('reverify.verdict')}: ${state.verdict ?? ''}${state.summary !== undefined ? ` — ${state.summary}` : ''}`}
      </p>
    )
  }
  const plan = state.plan
  const scopeValue = scope ?? hostOf(target)
  return (
    <div className={css.reverify}>
      <p className={css.note}>{plan.proves}</p>
      <p className={css.note}>{`${t('proof.steps')} (${plan.steps.length}) · ${t('proof.tier')}: ${plan.validationTier}`}</p>
      <label className={css.field}>
        <span>{t('reverify.scopeLabel')}</span>
        <input
          value={scopeValue}
          onChange={(change) => { setScope(change.target.value) }}
        />
      </label>
      <p className={css.note}>{t('reverify.planNote')}</p>
      <button
        type="button"
        className={css.button}
        onClick={() => {
          face.executeReverify(finding.id, scopeValue.split(',').map(host => host.trim()).filter(Boolean))
        }}
      >
        {t('reverify.execute')}
      </button>
    </div>
  )
}

/** One finding card with its proof and reverify affordances. */
function FindingCard({ finding, proof, reverify, target, face, t }: {
  finding: Finding
  proof: SectionState<ProofBundle> | undefined
  reverify: ReverifyState | undefined
  target: string
  face: ReverifyCallbacks
  t: TranslateNS<'redteamConsole'>
}): ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <article className={clsx(css.findingCard, css[SEVERITY_CLASS[finding.severity]])}>
      <header className={css.findingHead}>
        <span className={css.sevChip}>{finding.severity}</span>
        <h4 className={css.findingTitle}>{finding.title}</h4>
        <span className={css.mono}>{finding.id}</span>
      </header>
      <div className={css.findingMeta}>
        <span>{finding.status}</span>
        {finding.cellState !== undefined && <span>{`cell: ${finding.cellState}`}</span>}
        {finding.cvss !== undefined && <span>{`CVSS ${finding.cvss}`}</span>}
        {finding.cwe !== undefined && <span>{finding.cwe}</span>}
        {finding.producer !== undefined && <span>{finding.producer}</span>}
      </div>
      <div className={css.proofBlock}>
        <h5>{t('findings.evidence')}</h5>
        <p>{finding.evidence}</p>
      </div>
      <div className={css.proofBlock}>
        <h5>{t('findings.fix')}</h5>
        <p>{finding.fix}</p>
      </div>
      <div className={css.proofBlock}>
        <h5>{t('findings.retest')}</h5>
        <p>{finding.retest}</p>
      </div>
      <div className={css.findingActions}>
        {finding.hasProof && (
          <button
            type="button"
            className={css.button}
            onClick={() => {
              if (!open) face.loadProof(finding.id)
              setOpen(!open)
            }}
          >
            {open ? t('findings.hideProof') : t('findings.showProof')}
          </button>
        )}
        {finding.hasProof && (
          <ReverifyBlock finding={finding} state={reverify} target={target} face={face} t={t} />
        )}
      </div>
      {open && finding.hasProof && (
        proof === undefined || proof.kind === 'loading'
          ? <p className={css.note}>{t('proof.loading')}</p>
          : proof.kind === 'failed'
            ? <p className={css.errorLine}>{t('proof.failed', { message: proof.message })}</p>
            : <ProofView bundle={proof.value} t={t} />
      )}
    </article>
  )
}

/**
 * The findings section.
 * @param props - the section state, per-finding maps, the face, and copy.
 * @returns the finding cards for the selected engagement.
 */
export function FindingsSection({ section, proofByFinding, reverifyByFinding, target, face, t }: {
  section: SectionState<readonly Finding[]> | undefined
  proofByFinding: Readonly<Record<string, SectionState<ProofBundle>>>
  reverifyByFinding: Readonly<Record<string, ReverifyState>>
  target: string
  face: ReverifyCallbacks
  t: TranslateNS<'redteamConsole'>
}): ReactNode {
  if (section === undefined || section.kind === 'loading') {
    return <p className={css.note}>{t('section.loading')}</p>
  }
  if (section.kind === 'failed') {
    return <p className={css.errorLine}>{t('section.failed', { message: section.message })}</p>
  }
  if (section.value.length === 0) return <p className={css.note}>{t('findings.empty')}</p>
  return (
    <div className={css.findingList}>
      {section.value.map(finding => (
        <FindingCard
          key={finding.id}
          finding={finding}
          proof={proofByFinding[finding.id]}
          reverify={reverifyByFinding[finding.id]}
          target={target}
          face={face}
          t={t}
        />
      ))}
    </div>
  )
}
