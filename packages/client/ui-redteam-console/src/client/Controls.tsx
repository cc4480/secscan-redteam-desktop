/**
 * The console controls for one LIVE engagement: abort and autonomy tier.
 *
 * The safety semantics are the console's own page's, copied exactly — not
 * reinvented: abort asks for a reason (recorded in the audit log, default
 * prefilled) and then a confirming press, because it terminates in-flight
 * work immediately; a tier change requires a NAMED operator (someone must
 * own it) and a reason, and choosing Tier 2 in the confirm step IS the
 * explicit Tier-2 production approval the console records. Lower-stakes
 * presentation, identical rules.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type {} from './locales.ts'
import type { WatchInjected } from './face.ts'
import type { ConsoleEngagement } from './model.ts'
import css from './WatchBody.module.css'

/** The controls block's props: the live engagement, the face, the last outcome, and copy. */
export interface ControlsProps {
  readonly tabId: TabId
  readonly engagement: ConsoleEngagement
  readonly controlNote: string | undefined
  readonly controlOk: boolean
  readonly controlError: string | undefined
  readonly onAbort: WatchInjected['abort']
  readonly onEscalate: WatchInjected['escalate']
  readonly t: TranslateNS<'redteamConsole'>
}

/** The tier form's draft. */
interface TierDraft {
  tier: string
  operator: string
  reason: string
}

/**
 * The controls block.
 * @param props - the engagement, face callbacks, outcome, and copy.
 * @returns the abort and tier controls with their confirm drafts.
 */
export function Controls(props: ControlsProps): ReactNode {
  const { tabId, engagement, controlNote, controlOk, controlError, onAbort, onEscalate, t } = props
  const [abortReason, setAbortReason] = useState<string | undefined>(undefined)
  const [tierDraft, setTierDraft] = useState<TierDraft | undefined>(undefined)
  const [operatorMissing, setOperatorMissing] = useState(false)
  return (
    <section className={css.section}>
      <h3 className={css.sectionTitle}>{t('controls.title')}</h3>
      <div className={css.controlRow}>
        <button
          type="button"
          className={css.dangerButton}
          onClick={() => { setAbortReason(t('abort.defaultReason')) }}
        >
          {t('abort.button')}
        </button>
        <button
          type="button"
          className={css.button}
          onClick={() => { setTierDraft({ tier: '1', operator: '', reason: '' }); setOperatorMissing(false) }}
        >
          {t('tier.button')}
        </button>
      </div>
      {abortReason !== undefined && (
        <div className={css.draft}>
          <label className={css.field}>
            <span>{t('abort.reasonLabel')}</span>
            <input
              value={abortReason}
              onChange={(change) => { setAbortReason(change.target.value) }}
            />
          </label>
          <p className={css.note}>{t('abort.hint')}</p>
          <div className={css.controlRow}>
            <button
              type="button"
              className={css.dangerButton}
              onClick={() => { onAbort(tabId, engagement.id, abortReason); setAbortReason(undefined) }}
            >
              {t('abort.confirm')}
            </button>
            <button type="button" className={css.button} onClick={() => { setAbortReason(undefined) }}>
              {t('abort.cancel')}
            </button>
          </div>
        </div>
      )}
      {tierDraft !== undefined && (
        <div className={css.draft}>
          <label className={css.field}>
            <span>{t('tier.label')}</span>
            <select
              value={tierDraft.tier}
              onChange={(change) => { setTierDraft({ ...tierDraft, tier: change.target.value }) }}
            >
              <option value="0">{t('tier.0')}</option>
              <option value="1">{t('tier.1')}</option>
              <option value="2">{t('tier.2')}</option>
            </select>
          </label>
          <label className={css.field}>
            <span>{t('tier.operatorLabel')}</span>
            <input
              value={tierDraft.operator}
              onChange={(change) => { setTierDraft({ ...tierDraft, operator: change.target.value }) }}
            />
          </label>
          {operatorMissing && <p className={css.errorLine}>{t('tier.operatorRequired')}</p>}
          <label className={css.field}>
            <span>{t('tier.reasonLabel')}</span>
            <input
              value={tierDraft.reason}
              onChange={(change) => { setTierDraft({ ...tierDraft, reason: change.target.value }) }}
            />
          </label>
          {tierDraft.tier === '2' && <p className={css.note}>{t('tier.prodNote')}</p>}
          <div className={css.controlRow}>
            <button
              type="button"
              className={css.button}
              onClick={() => {
                if (tierDraft.operator.trim() === '') {
                  setOperatorMissing(true)
                  return
                }
                onEscalate(tabId, engagement.id, {
                  tier: tierDraft.tier,
                  operator: tierDraft.operator.trim(),
                  reason: tierDraft.reason.trim(),
                })
                setTierDraft(undefined)
              }}
            >
              {t('tier.confirm')}
            </button>
            <button type="button" className={css.button} onClick={() => { setTierDraft(undefined) }}>
              {t('abort.cancel')}
            </button>
          </div>
        </div>
      )}
      {controlError !== undefined && (
        <p className={css.errorLine}>{t('controls.failed', { message: controlError })}</p>
      )}
      {controlError === undefined && controlOk && (
        <p className={css.note}>{controlNote ?? t('controls.abortSent')}</p>
      )}
    </section>
  )
}
