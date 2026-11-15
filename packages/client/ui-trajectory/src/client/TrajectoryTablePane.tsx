/**
 * The virtualized trajectory table pane and its details inspector. Owns the
 * scroll follow, older-record loading, details resize, and record selection
 * state for one rendered conversation view.
 */
import css from './TrajectoryTable.module.css'
import type {
  DetailTab, DetailsResizeDrag, OlderLoadAnchor, ParentRecords,
  RecordState, RequestBoundaryStyle, SelectedRequest, TableRecord,
  TrajectorySplitStyle, TrajectoryTableProps, VirtualSpacerStyle,
} from './trajectory-table-types.ts'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { formatElapsedSeconds, trajectoryRecordId } from './trajectory-record.ts'
import { codeProgram } from './code-program.ts'
import {
  groupTrajectoryVirtualRows, trajectoryVirtualRecordKey,
} from './trajectory-virtual-rows.ts'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  IconChevronRightOutlineRegular, MarkdownText, StateDot, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  filterRecords, flattenRecords, indexRequestBoundaries, indexRequestBoundaryRuns,
  indexRequestNumbers, requestIdentity, requestKey, sectionLabel,
  useStableVirtualRowStructure,
} from './trajectory-table-rows.ts'
import {
  assistantToolCalls, collapseAssistantRecords, collapseTurnRecords, requestErrorMessage,
  stateOf, statusLabel,
} from './trajectory-table-collapse.ts'
import {
  BOTTOM_FOLLOW_THRESHOLD_PX, DETAILS_RESIZE_STEP, HISTORY_LOAD_ROW_HEIGHT_PX, KIND_LABEL_KEY,
  OLDER_LOAD_THRESHOLD_PX, REQUEST_TABS, TOOL_REQUEST_SHARE, VIRTUALIZATION_THRESHOLD,
  VIRTUAL_INITIAL_VIEWPORT_HEIGHT_PX, VIRTUAL_OVERSCAN_ROWS,
} from './trajectory-table-constants.ts'
import {
  MessageSource, detailTabs, isMarkdownRecord, messageSourceLabel,
  parentRecords,
} from './trajectory-table-details.tsx'
import { RecordListText, RecordPresentation } from './trajectory-table-presentation.tsx'
import { KIND_ICON } from './trajectory-table-glyphs.tsx'
import {
  clampDetailsWidth, defaultToolRequestWidth, markdownLabels,
} from './trajectory-table-labels.ts'
import { formatDurationMs } from './trajectory-table-timing.tsx'
import { OverviewSection, ProgramInput, ProgramOutput } from './trajectory-table-program.tsx'
import {
  RequestOptions, RequestUsagePanel, TokenRows, UsageRows,
} from './trajectory-table-usage.tsx'
import {
  MarkdownRecordContent, RecordTiming, RequestTiming,
} from './trajectory-table-record-content.tsx'
import { SystemPromptDiff, ToolCatalog } from './trajectory-table-tools.tsx'
import { RecordPayload, RecordSchema } from './trajectory-table-payload.tsx'

/**
 * Render trajectory events as a dense ledger with turn and step separators.
 * Clicking ledger whitespace clears the active record or request selection.
 * @param props - Grouped trajectory data and whole-ledger fold state.
 * @returns The ledger and an optional local record inspector.
 */
export function TrajectoryTable({
  t,
  stringWrapping,
  renderImages,
  requestNumbers: sessionRequestNumbers,
  turns,
  streamingCells = [],
  timelineFocusIndexes = null,
  searchMatchIndexes = null,
  onSelectedIndexChange,
  onRecordSelect,
  recordSelection = null,
  recordFocus = null,
  historyLoading = false,
  olderHistoryLoading = false,
  historyStartSeq,
  hasOlderRecords = false,
  onLoadOlder,
  onClearSelection,
  collapsedTurns,
  onToggleTurn,
  collapsedAssistants,
  onToggleAssistant,
  inspectCallId = null,
  onInspectApplied,
}: TrajectoryTableProps) {
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null)
  const [selectedRequest, setSelectedRequest] = useState<SelectedRequest | null>(null)
  const [activeTab, setActiveTab] = useState<DetailTab>('overview')
  const [codeWrappingOnOpen, setCodeWrappingOnOpen] = useState(false)
  const [thinkingDisclosure, setThinkingDisclosure] = useState<{ recordId: string; expanded: boolean }>()
  const [detailsWidth, setDetailsWidth] = useState<number | null>(null)
  const [toolRequestOffset, setToolRequestOffset] = useState<number | null>(null)
  const detailsResizeDrag = useRef<DetailsResizeDrag | null>(null)
  const appliedRecordSelection = useRef<TrajectoryTableProps['recordSelection']>(null)
  const appliedRecordFocus = useRef<TrajectoryTableProps['recordFocus']>(null)
  const tabHistory = useRef<Set<DetailTab>>(new Set(['overview']))
  const rootRef = useRef<HTMLDivElement>(null)
  const tablePaneRef = useRef<HTMLDivElement>(null)
  const followsTableTail = useRef(false)
  const tableScrollInitialized = useRef(false)
  const [tableScrollReady, setTableScrollReady] = useState(false)
  const pendingScrollRecordId = useRef<string | null>(null)
  const loadingOlder = useRef(false)
  const [olderLoading, setOlderLoading] = useState(false)
  const olderLoadAnchor = useRef<OlderLoadAnchor | null>(null)
  const allRecords = useMemo(() => flattenRecords(turns), [turns])
  const streamingCellsByIndex = useMemo(
    () => new Map(streamingCells.map(cell => [cell.index, cell])),
    [streamingCells],
  )
  const currentRecord = useCallback((record: TableRecord): TableRecord => {
    const cell = streamingCellsByIndex.get(record.cell.index)
    return cell === undefined ? record : { ...record, cell }
  }, [streamingCellsByIndex])
  const selectedTemplate = useMemo(() => selectedRecordId === null
    ? undefined
    : allRecords.find(record => trajectoryRecordId(record.cell) === selectedRecordId),
  [allRecords, selectedRecordId])
  const selected = selectedTemplate === undefined
    ? undefined
    : currentRecord(selectedTemplate)
  const selectedProgram = selected === undefined ? undefined : codeProgram(selected.cell)
  const thinkingExpanded = thinkingDisclosure?.recordId === selectedRecordId
    ? thinkingDisclosure.expanded
    : selected?.cell.kind === 'message'
      && Boolean(selected.cell.thinkingDetail?.trim())
  const setThinkingExpanded = (expanded: boolean) => {
    if (selectedRecordId !== null) {
      setThinkingDisclosure({ recordId: selectedRecordId, expanded })
    }
  }
  const selectedIndex = selected?.cell.index ?? null
  useEffect(() => {
    onSelectedIndexChange?.(selectedIndex)
  }, [onSelectedIndexChange, selectedIndex])
  const requestGroups = useMemo(() => new Set(
    (sessionRequestNumbers ?? []).map(request => requestKey(request.turn, request.group)),
  ), [sessionRequestNumbers])
  const requestBoundaries = useMemo(
    () => indexRequestBoundaries(allRecords, requestGroups),
    [allRecords, requestGroups],
  )
  const requestNumbers = useMemo(
    () => indexRequestNumbers(sessionRequestNumbers),
    [sessionRequestNumbers],
  )
  const records = useMemo(() => {
    if (searchMatchIndexes !== null) return filterRecords(allRecords, searchMatchIndexes)
    const turnRecords = collapsedTurns.size === 0
      ? allRecords
      : collapseTurnRecords(allRecords, collapsedTurns, requestGroups, t)
    return collapsedAssistants.size === 0
      ? turnRecords
      : collapseAssistantRecords(turnRecords, collapsedAssistants, t)
  }, [allRecords, collapsedAssistants, collapsedTurns, requestGroups, searchMatchIndexes, t])
  const projectedVirtualRows = useMemo(
    () => groupTrajectoryVirtualRows(records),
    [records],
  )
  const virtualRowStructure = useStableVirtualRowStructure(projectedVirtualRows)
  const virtualizationEnabled = hasOlderRecords
    || records.length > VIRTUALIZATION_THRESHOLD
  const virtualScrollMargin = hasOlderRecords ? HISTORY_LOAD_ROW_HEIGHT_PX : 0
  const estimateVirtualRowSize = useCallback(
    (index: number) => virtualRowStructure[index]?.height ?? 30,
    [virtualRowStructure],
  )
  const getVirtualRowKey = useCallback(
    (index: number) => virtualRowStructure[index]?.key ?? index,
    [virtualRowStructure],
  )
  const getTableScrollElement = useCallback(() => tablePaneRef.current, [])
  const rowVirtualizer = useVirtualizer<HTMLDivElement, HTMLTableRowElement>({
    count: virtualizationEnabled ? virtualRowStructure.length : 0,
    enabled: virtualizationEnabled,
    estimateSize: estimateVirtualRowSize,
    getItemKey: getVirtualRowKey,
    getScrollElement: getTableScrollElement,
    initialRect: { width: 0, height: VIRTUAL_INITIAL_VIEWPORT_HEIGHT_PX },
    anchorTo: 'end',
    overscan: VIRTUAL_OVERSCAN_ROWS,
    scrollMargin: virtualScrollMargin,
    scrollEndThreshold: BOTTOM_FOLLOW_THRESHOLD_PX,
    followOnAppend: 'auto',
  })
  const virtualIndexByRecordId = useMemo(() => {
    const indexes = new Map<string, number>()
    for (const [virtualIndex, row] of projectedVirtualRows.entries()) {
      for (const entry of row.entries) {
        if (entry.record.collapsedSummary === undefined) {
          indexes.set(trajectoryRecordId(entry.record.cell), virtualIndex)
        }
      }
    }
    return indexes
  }, [projectedVirtualRows])
  const virtualItems = virtualizationEnabled ? rowVirtualizer.getVirtualItems() : []
  const virtualTop = Math.max(0, (virtualItems[0]?.start ?? 0) - virtualScrollMargin)
  const virtualBottom = virtualItems.length === 0
    ? 0
    : Math.max(
      0,
      rowVirtualizer.getTotalSize()
        + virtualScrollMargin
        - (virtualItems.at(-1)?.end ?? 0),
    )
  const renderedRecords = virtualizationEnabled
    ? virtualItems.flatMap((item) => {
      const row = projectedVirtualRows[item.index]
      if (row === undefined) return []
      return row.entries.map((entry, entryIndex) => ({
        record: currentRecord(entry.record),
        position: entry.logicalIndex,
        terminalRequestBoundary:
          entry.record.cell.requestOnly === true
          && row.entries.at(-1)?.record.cell.requestOnly === true
          && entryIndex === row.entries.length - 1,
      }))
    })
    : records.map((record, position) => ({
      record: currentRecord(record),
      position,
      terminalRequestBoundary:
        record.cell.requestOnly === true && position === records.length - 1,
    }))
  const requestBoundaryRuns = useMemo(
    () => indexRequestBoundaryRuns(records, requestGroups),
    [records, requestGroups],
  )
  const selectedPrompt = selected?.cell.kind === 'system'
    ? selected.cell.promptDetail
    : undefined
  const selectedPreviousPrompt = selected?.cell.kind === 'system'
    ? selected.cell.previousPromptDetail
    : undefined
  const selectedSystemPrompt = selectedPrompt?.system ?? selected?.cell.systemPromptDetail
  const promptSelected = selectedSystemPrompt !== undefined
  const selectedState = selected === undefined ? undefined : stateOf(selected)
  const selectedRequestInfo = selectedRequest === null
    ? undefined
    : sessionRequestNumbers?.find(request =>
      requestIdentity(request) === selectedRequest.identity)
  const selectedRequestRecordTemplates = useMemo(() => selectedRequestInfo === undefined
    ? []
    : allRecords.filter(record =>
      record.turn === selectedRequestInfo.turn
        && record.group === selectedRequestInfo.group,
    ), [allRecords, selectedRequestInfo])
  const selectedRequestRecords = selectedRequestRecordTemplates.map(currentRecord)
  const selectedRequestAssistant = selectedRequestRecords.find(
    record => record.cell.kind === 'message',
  )
  const selectedRequestAnchor = selectedRequestAssistant ?? selectedRequestRecords[0]
  const selectedRequestNumber = selectedRequestInfo?.number
  const selectedRequestState: RecordState | undefined = selectedRequestInfo === undefined
    ? undefined
    : selectedRequestInfo.status
      ?? (selectedRequestAssistant?.cell.assistantMetrics?.completedTime === null
        ? 'running'
        : selectedRequestAssistant === undefined
          && selectedRequestRecords.some(record => stateOf(record) === 'running')
          ? 'running'
          : 'complete')
  const selectedRequestToolCalls = selectedRequestRecords.filter(
    record => record.cell.kind === 'tool',
  ).length
  const selectedRequestSubtoolCalls = selectedRequestRecords.filter(
    record => record.cell.kind === 'subtool',
  ).length
  const selectedRequestResultTemplate = selectedRequestInfo?.resultSeq === undefined
    ? selectedRequestAssistant
    : allRecords.find(record => record.cell.sourceSeq === selectedRequestInfo.resultSeq)
  const selectedRequestResult = selectedRequestResultTemplate === undefined
    ? undefined
    : currentRecord(selectedRequestResultTemplate)
  const selectedRequestUsage = selectedRequestInfo?.usage ?? (
    selectedRequestAssistant === undefined
      ? undefined
      : {
        ...(selectedRequestAssistant.cell.input === undefined
          ? {}
          : { input: selectedRequestAssistant.cell.input }),
        ...(selectedRequestAssistant.cell.cacheRead === undefined
          ? {}
          : { cacheRead: selectedRequestAssistant.cell.cacheRead }),
        ...(selectedRequestAssistant.cell.cacheWrite === undefined
          ? {}
          : { cacheWrite: selectedRequestAssistant.cell.cacheWrite }),
        ...(selectedRequestAssistant.cell.output === undefined
          ? {}
          : { output: selectedRequestAssistant.cell.output }),
        ...(selectedRequestAssistant.cell.think === undefined
          ? {}
          : { reasoning: selectedRequestAssistant.cell.think }),
      }
  )
  const selectedRequestCumulativeUsage =
    selectedRequestInfo?.cumulativeUsage ?? selectedRequestUsage
  const selectedRequestOptions = selectedRequestInfo?.requestConfig
  const activeTurn = selectedRequestInfo === undefined ? selected?.turn : selectedRequestInfo.turn
  const activeSection = selectedRequestInfo === undefined
    ? selected?.section
    : selectedRequestRecords[0]?.section
  const selectedTabs = selectedRequestInfo !== undefined
    ? REQUEST_TABS.filter(tab => tab.id !== 'options' || selectedRequestOptions !== undefined)
    : selected === undefined ? [] : detailTabs(selected)
  const selectedParents: ParentRecords = selected === undefined
    ? {}
    : parentRecords(allRecords, selected)
  const selectedParentMessage = selectedParents.message
  const selectedParentTool = selectedParents.tool
  const selectedAssistantRequest = selected?.cell.kind === 'message'
    ? requestNumbers.get(requestKey(selected.turn, selected.group))
    : undefined
  const selectedAssistantRequestInfo = selectedAssistantRequest === undefined
    ? undefined
    : sessionRequestNumbers?.find(request => request.number === selectedAssistantRequest)
  const selectedAssistantRequestTarget: SelectedRequest | undefined =
    selectedAssistantRequestInfo === undefined
      ? undefined
      : { identity: requestIdentity(selectedAssistantRequestInfo) }
  const hasSelectedHierarchy = selectedAssistantRequestTarget !== undefined
    || selectedParents.message !== undefined
    || selectedParents.tool !== undefined
  const splitStyle: TrajectorySplitStyle | undefined = toolRequestOffset === null
    ? undefined
    : {
      '--trajectory-tool-request-width': `calc(58cqw - ${toolRequestOffset}px)`,
    }

  const activateTab = (tab: DetailTab) => {
    setCodeWrappingOnOpen(stringWrapping?.getDefault() ?? false)
    tabHistory.current.delete(tab)
    tabHistory.current.add(tab)
    setActiveTab(tab)
  }

  const clearInspectorSelection = () => {
    setSelectedRecordId(null)
    setSelectedRequest(null)
  }

  const clearAllSelections = () => {
    clearInspectorSelection()
    onClearSelection?.()
  }

  const selectRecord = useCallback((index: number) => {
    setCodeWrappingOnOpen(stringWrapping?.getDefault() ?? false)
    const record = allRecords.find(candidate => candidate.cell.index === index)
    onRecordSelect?.(index)
    setSelectedRequest(null)
    setSelectedRecordId(record === undefined ? null : trajectoryRecordId(record.cell))
    if (record === undefined) return
    const tabs = detailTabs(record)
    const available = new Set(tabs.map(tab => tab.id))
    const recent = [...tabHistory.current].reverse().find(tab => available.has(tab))
    setActiveTab(recent ?? tabs[0]?.id ?? 'overview')
  }, [allRecords, onRecordSelect, stringWrapping])
  useEffect(() => {
    if (
      recordSelection === null
      || appliedRecordSelection.current === recordSelection
    ) return
    appliedRecordSelection.current = recordSelection
    selectRecord(recordSelection.index)
    const record = allRecords.find(candidate => candidate.cell.index === recordSelection.index)
    pendingScrollRecordId.current = record === undefined
      ? null
      : trajectoryRecordId(record.cell)
  }, [allRecords, recordSelection, selectRecord])
  useEffect(() => {
    if (recordFocus === null || appliedRecordFocus.current === recordFocus) return
    appliedRecordFocus.current = recordFocus
    const record = allRecords.find(candidate => candidate.cell.index === recordFocus.index)
    pendingScrollRecordId.current = record === undefined
      ? null
      : trajectoryRecordId(record.cell)
  }, [allRecords, recordFocus])

  const selectRequest = (
    request: SelectedRequest,
    tab: 'overview' | 'timing' = 'overview',
  ) => {
    setSelectedRecordId(null)
    setSelectedRequest(request)
    activateTab(tab)
  }

  const openRecordSummary = (target: TableRecord) => {
    const targetAt = allRecords.findIndex(record => record.cell.index === target.cell.index)
    if (target.turn !== null && collapsedTurns.has(target.turn)) onToggleTurn(target.turn)
    if (target.cell.kind === 'tool' || target.cell.kind === 'subtool') {
      for (let i = targetAt - 1; i >= 0; i--) {
        const candidate = allRecords[i]
        if (candidate === undefined || candidate.turn !== target.turn) break
        if (candidate.cell.kind !== 'message') continue
        const assistantId = trajectoryRecordId(candidate.cell)
        if (collapsedAssistants.has(assistantId)) onToggleAssistant(assistantId)
        break
      }
    }
    setSelectedRequest(null)
    setSelectedRecordId(trajectoryRecordId(target.cell))
    activateTab('overview')
  }

  const openCallSummary = (callId: string) => {
    const target = allRecords.find(record => record.cell.callId === callId)
    if (target !== undefined) openRecordSummary(target)
  }

  // Cross-view inspect handoff: resolve the requested call to its record,
  // open its summary, and remember the row to scroll once the un-collapsed
  // ledger has rendered. Not-found leaves the request pending (`turns` in the
  // deps retries as history pages in); the ack clears the store field.
  const openRecordSummaryRef = useRef(openRecordSummary)
  openRecordSummaryRef.current = openRecordSummary
  useEffect(() => {
    if (inspectCallId === null) return
    const target = flattenRecords(turns).find(record => record.cell.callId === inspectCallId)
    if (target === undefined) return
    openRecordSummaryRef.current(target)
    pendingScrollRecordId.current = trajectoryRecordId(target.cell)
    onInspectApplied?.()
  }, [inspectCallId, turns, onInspectApplied])
  useEffect(() => {
    const id = pendingScrollRecordId.current
    if (id === null) return
    const position = records.findIndex(record =>
      trajectoryRecordId(record.cell) === id && record.collapsedSummary === undefined)
    if (position === -1) return
    if (virtualizationEnabled) {
      const virtualIndex = virtualIndexByRecordId.get(id)
      if (virtualIndex === undefined) return
      pendingScrollRecordId.current = null
      followsTableTail.current = false
      rowVirtualizer.scrollToIndex(virtualIndex, { behavior: 'smooth', align: 'center' })
      return
    }
    pendingScrollRecordId.current = null
    followsTableTail.current = false
    const recordIndex = records[position]?.cell.index
    const row = recordIndex === undefined
      ? null
      : rootRef.current?.querySelector<HTMLElement>(`tr[data-record-index="${recordIndex}"]`)
    /* v8 ignore next -- jsdom lacks scrollIntoView; browsers always have it. */
    if (row !== undefined && row !== null && typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [records, rowVirtualizer, virtualIndexByRecordId, virtualizationEnabled])
  useEffect(() => {
    if (timelineFocusIndexes === null || timelineFocusIndexes.size === 0) return
    const focusedPositions = records.flatMap((record, position) =>
      record.collapsedSummary === undefined
      && record.cell.requestOnly !== true
      && timelineFocusIndexes.has(record.cell.index)
        ? [position]
        : [])
    const first = focusedPositions.at(0)
    const last = focusedPositions.at(-1)
    if (first === undefined || last === undefined) return
    if (!virtualizationEnabled) {
      const ledger = rootRef.current
      if (ledger === null) return
      const focusedRows = [
        ...ledger.querySelectorAll<HTMLElement>('tr[data-timeline-focus="inside"]'),
      ]
      const firstRow = focusedRows.at(0)
      const lastRow = focusedRows.at(-1)
      if (firstRow === undefined || lastRow === undefined) return
      const focusHeight =
        lastRow.getBoundingClientRect().bottom - firstRow.getBoundingClientRect().top
      const target = focusHeight > ledger.clientHeight
        ? firstRow
        : focusedRows[Math.floor((focusedRows.length - 1) / 2)]
      /* v8 ignore next -- jsdom lacks scrollIntoView; browsers always have it. */
      if (target !== undefined && typeof target.scrollIntoView === 'function') {
        followsTableTail.current = false
        target.scrollIntoView({
          behavior: 'smooth',
          block: focusHeight > ledger.clientHeight ? 'start' : 'center',
        })
      }
      return
    }
    const focusedVirtualIndexes = [...new Set(focusedPositions.flatMap((position) => {
      const record = records[position]
      if (record === undefined) return []
      const virtualIndex = virtualIndexByRecordId.get(trajectoryRecordId(record.cell))
      return virtualIndex === undefined ? [] : [virtualIndex]
    }))].sort((left, right) => left - right)
    const firstVirtual = focusedVirtualIndexes.at(0)
    const lastVirtual = focusedVirtualIndexes.at(-1)
    if (firstVirtual === undefined || lastVirtual === undefined) return
    const paneHeight = tablePaneRef.current?.clientHeight ?? 0
    const focusHeight = projectedVirtualRows
      .slice(firstVirtual, lastVirtual + 1)
      .reduce((height, row) => height + row.height, 0)
    followsTableTail.current = false
    rowVirtualizer.scrollToIndex(
      focusHeight > paneHeight
        ? firstVirtual
        : focusedVirtualIndexes[Math.floor((focusedVirtualIndexes.length - 1) / 2)]
          ?? firstVirtual,
      {
        behavior: 'smooth',
        align: focusHeight > paneHeight ? 'start' : 'center',
      },
    )
  }, [
    projectedVirtualRows,
    records,
    rowVirtualizer,
    timelineFocusIndexes,
    virtualIndexByRecordId,
    virtualizationEnabled,
  ])
  const requestOlder = useCallback((pane: HTMLDivElement, requireTop: boolean) => {
    if (
      !hasOlderRecords
      || onLoadOlder === undefined
      || loadingOlder.current
      || olderHistoryLoading
      || (requireTop && pane.scrollTop > OLDER_LOAD_THRESHOLD_PX)
    ) return
    loadingOlder.current = true
    setOlderLoading(true)
    olderLoadAnchor.current = {
      historyStartSeq,
      scrollHeight: pane.scrollHeight,
      scrollTop: pane.scrollTop,
    }
    void onLoadOlder().then((advanced) => {
      if (!advanced) olderLoadAnchor.current = null
    }).finally(() => {
      loadingOlder.current = false
      setOlderLoading(false)
    })
  }, [hasOlderRecords, historyStartSeq, olderHistoryLoading, onLoadOlder])
  useLayoutEffect(() => {
    const pane = tablePaneRef.current
    if (pane === null) return
    const anchor = olderLoadAnchor.current
    if (anchor !== null && anchor.historyStartSeq !== historyStartSeq) {
      if (!virtualizationEnabled) {
        pane.scrollTop = anchor.scrollTop + pane.scrollHeight - anchor.scrollHeight
      }
      olderLoadAnchor.current = null
      followsTableTail.current = false
      return
    }
    if (!tableScrollInitialized.current) {
      if (historyLoading) return
      tableScrollInitialized.current = true
      followsTableTail.current = true
      if (virtualizationEnabled) rowVirtualizer.scrollToEnd({ behavior: 'auto' })
      else pane.scrollTop = pane.scrollHeight
      setTableScrollReady(true)
      return
    }
    if (!followsTableTail.current) return
    if (!virtualizationEnabled) pane.scrollTop = pane.scrollHeight
  }, [
    historyLoading,
    historyStartSeq,
    rowVirtualizer,
    virtualRowStructure,
    virtualizationEnabled,
  ])

  const olderBusy = olderHistoryLoading || olderLoading
  const showInitialLoading = historyLoading || !tableScrollReady
  const historyRowOffset = hasOlderRecords ? 1 : 0

  return (
    <div ref={rootRef} className={css.split} style={splitStyle}>
      <div
        ref={tablePaneRef}
        className={css.tablePane}
        data-trajectory-scroll=""
        onScroll={(event) => {
          const pane = event.currentTarget
          followsTableTail.current =
            pane.scrollHeight - pane.clientHeight - pane.scrollTop
              <= BOTTOM_FOLLOW_THRESHOLD_PX
          requestOlder(pane, true)
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) clearAllSelections()
        }}
      >
        {showInitialLoading && (
          <div className={css.historyLoading} role="status" aria-live="polite">
            <span className={css.historyLoadingBar}>
              <StateDot state="ongoing" />
              {t('history.loadingTrajectory')}
            </span>
          </div>
        )}
        <table
          className={css.table}
          data-scroll-ready={tableScrollReady || undefined}
          aria-rowcount={records.length + historyRowOffset}
        >
          <colgroup>
            <col className={css.eventColumn} />
            <col className={css.contentColumn} />
          </colgroup>
          <tbody>
            {hasOlderRecords && (
              <tr
                className={css.historyLoadRow}
                data-history-load=""
                aria-rowindex={1}
              >
                <td colSpan={2}>
                  <button
                    type="button"
                    className={css.historyLoadButton}
                    disabled={olderBusy || onLoadOlder === undefined}
                    aria-label={olderBusy
                      ? t('history.loadingEarlierAria')
                      : t('history.loadEarlier')}
                    onClick={() => {
                      const pane = tablePaneRef.current
                      if (pane !== null) requestOlder(pane, false)
                    }}
                  >
                    {olderBusy && (
                      <StateDot state="ongoing" />
                    )}
                    <span aria-hidden="true">
                      {olderBusy ? t('history.loadingEarlier') : t('history.loadEarlier')}
                    </span>
                    <span className={css.visuallyHidden} role="status" aria-live="polite">
                      {olderBusy ? t('history.loadingEarlier') : ''}
                    </span>
                  </button>
                </td>
              </tr>
            )}
            {virtualTop > 0 && (
              <tr className={css.virtualSpacer} data-virtual-spacer="top" aria-hidden="true">
                <td
                  colSpan={2}
                  style={{
                    '--trajectory-virtual-spacer-height': `${virtualTop}px`,
                  } as VirtualSpacerStyle}
                />
              </tr>
            )}
            {renderedRecords.map(({ record, position, terminalRequestBoundary }) => (
              <RecordPresentation
                key={trajectoryVirtualRecordKey(record)}
                cell={record.cell}
                t={t}
              >
                {({ displayText, listDisplayText, resultText, toolCallOnly, toolCallText }) => {
                  const isCollapsedSummary = record.collapsedSummary !== undefined
                  const isRequestOnly = record.cell.requestOnly === true
                  const isInitialSystem = record.cell.kind === 'system'
                && record.cell.index === allRecords[0]?.cell.index
                  const key = requestKey(record.turn, record.group)
                  const request = requestBoundaries.get(key) === record.cell.index
                && !isCollapsedSummary
                && (record.turn === null || !collapsedTurns.has(record.turn))
                    ? requestNumbers.get(key)
                    : undefined
                  const requestInfo = request === undefined
                    ? undefined
                    : sessionRequestNumbers?.find(candidate => candidate.number === request)
                  const requestStatus = requestInfo?.status
                ?? (record.cell.isError === true ? 'error' : undefined)
                  const requestRunIndex = requestBoundaryRuns.get(record.cell.index) ?? 0
                  const requestBoundaryStyle: RequestBoundaryStyle = {
                    '--request-boundary-offset': `${requestRunIndex * 8}px`,
                  }
                  const requestLabel = request === undefined
                    ? undefined
                    : t(requestInfo?.purpose === 'compaction'
                      ? 'request.labelCompaction'
                      : 'request.label', { request })
                  const requestSelected = requestInfo !== undefined
                && selectedRequest?.identity === requestIdentity(requestInfo)
                  const sectionActive = record.turn === null
                    ? activeSection === record.section
                    : activeTurn === record.turn
                  return (
                    <tr
                      tabIndex={isRequestOnly ? -1 : 0}
                      aria-rowindex={position + 1 + historyRowOffset}
                      aria-label={isCollapsedSummary
                        ? t('request.collapsedSummary', {
                          kind: t(record.collapsedSummaryKind === 'turn'
                            ? 'request.collapsedTurn'
                            : 'request.collapsedAssistant'),
                          summary: record.collapsedSummary,
                        })
                        : isRequestOnly
                          ? t('request.rowAriaCompaction', { request: request ?? '' })
                          : t('request.rowAria', {
                            request: request === undefined ? '' : t('request.rowPrefix', { request }),
                            kind: t(KIND_LABEL_KEY[record.cell.kind]),
                            content: listDisplayText || t('request.noContent'),
                          })}
                      aria-selected={!isCollapsedSummary && !isRequestOnly && selectedIndex === record.cell.index}
                      data-kind={record.cell.kind}
                      data-trajectory-row-key={trajectoryVirtualRecordKey(record)}
                      data-virtual-position={virtualizationEnabled ? position : undefined}
                      data-record-index={!isCollapsedSummary && !isRequestOnly
                        ? record.cell.index
                        : undefined}
                      data-request-only={isRequestOnly || undefined}
                      data-terminal-request-boundary={terminalRequestBoundary || undefined}
                      data-group-start={record.groupStart || undefined}
                      data-turn-start={record.turnStart || undefined}
                      data-error={record.cell.isError || undefined}
                      data-running={stateOf(record) === 'running' || undefined}
                      data-turn-end={record.turnEnd || undefined}
                      data-collapsed-summary={record.collapsedSummaryKind}
                      data-selected={!isCollapsedSummary && selectedIndex === record.cell.index || undefined}
                      data-timeline-focus={isCollapsedSummary || timelineFocusIndexes === null
                        ? undefined
                        : timelineFocusIndexes.has(record.cell.index) ? 'inside' : 'outside'}
                      onClick={isRequestOnly
                        ? undefined
                        : isCollapsedSummary
                          ? () => {
                            if (record.collapsedSummaryKind === 'turn' && record.turn !== null) {
                              onToggleTurn(record.turn)
                            } else onToggleAssistant(trajectoryRecordId(record.cell))
                          }
                          : () => { selectRecord(record.cell.index) }}
                      onDoubleClick={(event) => {
                        if (isCollapsedSummary || isRequestOnly) return
                        if (record.turn !== null && collapsedTurns.has(record.turn)) {
                          event.preventDefault()
                          onToggleTurn(record.turn)
                          return
                        }
                        if (
                          record.cell.kind === 'message'
                      && assistantToolCalls(allRecords, record.cell.index).length > 0
                        ) {
                          event.preventDefault()
                          onToggleAssistant(trajectoryRecordId(record.cell))
                          return
                        }
                        if (!record.turnStart) return
                        if (record.turn === null) return
                        if (allRecords.filter(candidate =>
                          candidate.turn === record.turn
                      && candidate.cell.requestOnly !== true
                      && candidate.cell.kind !== 'system').length <= 1) return
                        event.preventDefault()
                        onToggleTurn(record.turn)
                      }}
                      onKeyDown={(event) => {
                        if (isRequestOnly) return
                        if (event.key !== 'Enter' && event.key !== ' ') return
                        event.preventDefault()
                        if (isCollapsedSummary) {
                          if (record.collapsedSummaryKind === 'turn' && record.turn !== null) {
                            onToggleTurn(record.turn)
                          } else onToggleAssistant(trajectoryRecordId(record.cell))
                          return
                        }
                        selectRecord(record.cell.index)
                      }}
                    >
                      <td className={css.event}>
                        {request !== undefined && (
                          <button
                            type="button"
                            className={requestSelected
                              ? `${css.requestBoundaryControl} ${css.requestBoundaryControlActive}`
                              : css.requestBoundaryControl}
                            aria-label={requestLabel}
                            aria-pressed={requestSelected}
                            data-label={requestLabel}
                            data-request-run-index={requestRunIndex}
                            data-request-status={requestStatus}
                            style={requestBoundaryStyle}
                            onClick={(event) => {
                              event.stopPropagation()
                              if (requestInfo !== undefined) {
                                selectRequest({ identity: requestIdentity(requestInfo) })
                              }
                            }}
                            onDoubleClick={(event) => { event.stopPropagation() }}
                          />
                        )}
                        {record.turn !== null
                    && activeTurn === record.turn
                    && !isInitialSystem && (
                          <span className={css.turnRail} aria-hidden="true" />
                        )}
                        {!isCollapsedSummary && selectedIndex === record.cell.index && (
                          <span className={css.selectionRail} aria-hidden="true" />
                        )}
                        {!isCollapsedSummary
                    && !isRequestOnly
                    && record.turnStart && (
                          <span
                            className={sectionActive
                              ? `${css.turnLabel} ${css.turnLabelActive}`
                              : css.turnLabel}
                            aria-label={sectionLabel(record.turn, t)}
                          >
                            {record.turn === null
                              ? sectionLabel(record.turn, t)
                              : (
                                <>
                                  <span className={css.turnLabelFull} aria-hidden="true">
                                    {sectionLabel(record.turn, t)}
                                  </span>
                                  <span className={css.turnLabelCompact} aria-hidden="true">
                                    #{record.turn}
                                  </span>
                                </>
                              )}
                          </span>
                        )}
                        <div className={css.eventInner}>
                          {!isCollapsedSummary && !isRequestOnly && (
                            <span
                              className={css.kindSlot}
                            >
                              <span
                                className={`${css.kindTag} ${
                                  record.cell.kind === 'system'
                                    ? css.systemNeutral
                                    : record.cell.kind === 'context'
                                      ? css.contextGreen
                                      : record.cell.kind === 'compacted'
                                        ? css.compacted
                                        : record.cell.kind === 'tool'
                                          ? css.toolAmber
                                          : record.cell.kind === 'message'
                                            ? css.assistantVioletBright
                                            : record.cell.kind === 'subtool'
                                              ? css.subtoolAmber
                                              : css[record.cell.kind]
                                }`}
                                data-role-kind={record.cell.kind}
                              >
                                <Tooltip
                                  label={t(KIND_LABEL_KEY[record.cell.kind])}
                                  side="right"
                                >
                                  <span className={css.kindTagIcon} aria-hidden="true">
                                    {KIND_ICON[record.cell.kind]}
                                  </span>
                                </Tooltip>
                                <span className={css.kindTagLabel}>
                                  {t(KIND_LABEL_KEY[record.cell.kind])}
                                </span>
                              </span>
                            </span>
                          )}
                        </div>
                      </td>
                      <td className={css.content}>
                        {isRequestOnly
                          ? null
                          : record.collapsedSummary !== undefined
                            ? (
                              <span className={css.collapsedTurnContent} title={record.collapsedSummary}>
                                <span className={css.collapsedTurnEllipsis}>…</span>
                                <span className={css.collapsedTurnText}>{record.collapsedSummary}</span>
                              </span>
                            )
                            : (
                              <span
                                className={resultText === undefined ? css.contentText : css.resultPreview}
                                title={resultText === undefined
                                  ? listDisplayText
                                  : `${listDisplayText} → ${resultText}`}
                              >
                                <span className={resultText === undefined ? undefined : css.resultRequest}>
                                  <RecordListText
                                    displayText={displayText}
                                    toolCallOnly={toolCallOnly}
                                    toolCallText={toolCallText}
                                    t={t}
                                  />
                                </span>
                                {resultText !== undefined && (
                                  <span className={record.cell.isError ? `${css.inlineResult} ${css.error}` : css.inlineResult}>
                                    <span className={css.arrow}>→</span>
                                    <span className={resultText === t('record.noOutput')
                                      ? `${css.inlineResultText} ${css.noOutputText}`
                                      : css.inlineResultText}
                                    >
                                      {resultText}
                                    </span>
                                  </span>
                                )}
                              </span>
                            )}
                      </td>
                    </tr>
                  )
                }}
              </RecordPresentation>
            ))}
            {virtualBottom > 0 && (
              <tr className={css.virtualSpacer} data-virtual-spacer="bottom" aria-hidden="true">
                <td
                  colSpan={2}
                  style={{
                    '--trajectory-virtual-spacer-height': `${virtualBottom}px`,
                  } as VirtualSpacerStyle}
                />
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {(selectedRequestInfo !== undefined
        || promptSelected
        || (selected !== undefined && selectedState !== undefined)) && (
        <aside
          className={css.details}
          aria-label={t('details.event')}
          style={detailsWidth === null ? undefined : { width: detailsWidth }}
        >
          <div
            className={css.detailsResizeHandle}
            role="separator"
            aria-label={t('details.resize')}
            aria-controls="trajectory-detail-panel"
            aria-orientation="vertical"
            tabIndex={0}
            title={t('details.resizeTitle')}
            onDoubleClick={() => {
              setDetailsWidth(null)
              setToolRequestOffset(null)
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              const details = event.currentTarget.parentElement
              if (details === null) return
              const split = details.parentElement
              if (split === null) return
              const splitWidth = split.getBoundingClientRect().width
              detailsResizeDrag.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startWidth: details.getBoundingClientRect().width,
                splitWidth,
                startToolRequestOffset: toolRequestOffset ?? (
                  splitWidth * TOOL_REQUEST_SHARE - defaultToolRequestWidth(splitWidth)
                ),
              }
              event.currentTarget.setPointerCapture(event.pointerId)
              event.preventDefault()
            }}
            onPointerMove={(event) => {
              const drag = detailsResizeDrag.current
              if (drag === null || drag.pointerId !== event.pointerId) return
              const nextDetailsWidth = clampDetailsWidth(
                drag.startWidth + drag.startX - event.clientX,
                drag.splitWidth,
              )
              setDetailsWidth(nextDetailsWidth)
              setToolRequestOffset(
                drag.startToolRequestOffset
                + (nextDetailsWidth - drag.startWidth) * TOOL_REQUEST_SHARE,
              )
            }}
            onPointerUp={(event) => {
              if (detailsResizeDrag.current?.pointerId !== event.pointerId) return
              detailsResizeDrag.current = null
              event.currentTarget.releasePointerCapture(event.pointerId)
            }}
            onPointerCancel={() => {
              detailsResizeDrag.current = null
            }}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
              const details = event.currentTarget.parentElement
              if (details === null) return
              const split = details.parentElement
              if (split === null) return
              const direction = event.key === 'ArrowLeft' ? 1 : -1
              const currentDetailsWidth = details.getBoundingClientRect().width
              const splitWidth = split.getBoundingClientRect().width
              const nextDetailsWidth = clampDetailsWidth(
                currentDetailsWidth + direction * DETAILS_RESIZE_STEP,
                splitWidth,
              )
              const currentToolRequestOffset = toolRequestOffset ?? (
                splitWidth * TOOL_REQUEST_SHARE - defaultToolRequestWidth(splitWidth)
              )
              setDetailsWidth(nextDetailsWidth)
              setToolRequestOffset(
                currentToolRequestOffset
                + (nextDetailsWidth - currentDetailsWidth) * TOOL_REQUEST_SHARE,
              )
              event.preventDefault()
            }}
          />
          <div className={css.detailsHeader}>
            <div className={css.detailsTitle}>
              {selectedRequestInfo !== undefined
                ? (
                  <>
                    <span className={css.requestDetailsDot} aria-hidden="true" />
                    <span className={css.requestDetailsName}>
                      {t('request.label', { request: selectedRequestNumber ?? '—' })}
                    </span>
                    <span className={css.detailsLocation}>
                      {selectedRequestInfo.purpose === 'compaction'
                        ? t('request.compaction', { section: sectionLabel(selectedRequestInfo.turn, t) })
                        : sectionLabel(selectedRequestInfo.turn, t)}
                    </span>
                  </>
                )
                : promptSelected
                  ? (
                    <>
                      <span className={`${css.kindTag} ${css.systemNeutral}`}>{t('kind.system')}</span>
                      <span className={css.detailsLocation}>{selected?.cell.text}</span>
                    </>
                  )
                  : selected !== undefined && (
                    <>
                      <span className={`${css.kindTag} ${
                        selected.cell.kind === 'context'
                          ? css.contextGreen
                          : selected.cell.kind === 'compacted'
                            ? css.compacted
                            : selected.cell.kind === 'tool'
                              ? css.toolAmber
                              : selected.cell.kind === 'message'
                                ? css.assistantVioletBright
                                : selected.cell.kind === 'subtool'
                                  ? css.subtoolAmber
                                  : css[selected.cell.kind]
                      }`}
                      >
                        {t(KIND_LABEL_KEY[selected.cell.kind])}
                      </span>
                      <span className={css.detailsLocation}>
                        {selected.cell.kind === 'compacted'
                          ? sectionLabel(selected.turn, t)
                          : `${sectionLabel(selected.turn, t)} · ${selected.group}`}
                      </span>
                    </>
                  )}
            </div>
            <button
              type="button"
              className={css.close}
              aria-label={t('details.close')}
              onClick={clearInspectorSelection}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <div className={css.detailTabs} role="tablist" aria-label={t('details.event')}>
            {selectedTabs.map(tab => (
              <button
                key={tab.id}
                id={`trajectory-detail-${tab.id}`}
                type="button"
                role="tab"
                aria-controls="trajectory-detail-panel"
                aria-selected={activeTab === tab.id}
                className={activeTab === tab.id ? `${css.detailTab} ${css.detailTabActive}` : css.detailTab}
                onClick={() => { activateTab(tab.id) }}
              >
                {t(tab.labelKey)}
              </button>
            ))}
          </div>
          <div
            id="trajectory-detail-panel"
            className={activeTab === 'overview'
              ? `${css.detailBody} ${css.detailBodySummary}`
              : selectedProgram !== undefined && (activeTab === 'input' || activeTab === 'output')
                ? `${css.detailBody} ${css.detailBodyProgram}`
                : css.detailBody}
            role="tabpanel"
            aria-labelledby={`trajectory-detail-${activeTab}`}
          >
            {selectedRequestInfo !== undefined
              && selectedRequestState !== undefined
              && activeTab === 'overview' && (
              <>
                <dl
                  className={`${css.overview} ${css.summaryScrollRegion}`}
                  data-summary-scroll-region=""
                >
                  <div>
                    <dt>{t('details.status')}</dt>
                    <dd className={selectedRequestState === 'error' ? css.error : undefined}>
                      {statusLabel(selectedRequestState, t)}
                    </dd>
                  </div>
                  {selectedRequestInfo.purpose === 'compaction' && (
                    <div>
                      <dt>{t('details.purpose')}</dt>
                      <dd>{t('request.compactionPurpose')}</dd>
                    </div>
                  )}
                  {(selectedRequestInfo.provider
                    ?? selectedRequestInfo.requestConfig?.provider) !== undefined && (
                    <div>
                      <dt>{t('details.provider')}</dt>
                      <dd>
                        {selectedRequestInfo.provider
                          ?? selectedRequestInfo.requestConfig?.provider}
                      </dd>
                    </div>
                  )}
                  {(selectedRequestInfo.model
                    ?? selectedRequestInfo.requestConfig?.model) !== undefined && (
                    <div>
                      <dt>{t('details.model')}</dt>
                      <dd>
                        {selectedRequestInfo.model
                          ?? selectedRequestInfo.requestConfig?.model}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>{t('details.toolCalls')}</dt>
                    <dd>{selectedRequestToolCalls}</dd>
                  </div>
                  {selectedRequestSubtoolCalls > 0 && (
                    <div>
                      <dt>{t('details.subtoolCalls')}</dt>
                      <dd>{selectedRequestSubtoolCalls}</dd>
                    </div>
                  )}
                  {selectedRequestInfo.error !== undefined && (
                    <div>
                      <dt>{t('details.error')}</dt>
                      <dd className={css.error}>{requestErrorMessage(selectedRequestInfo, t)}</dd>
                    </div>
                  )}
                  {selectedRequestInfo.retry !== undefined && (
                    <div>
                      <dt>{t('details.retry')}</dt>
                      <dd>
                        {t('details.scheduled')} {selectedRequestInfo.maxRetries === undefined
                          ? selectedRequestInfo.retry
                          : t('request.retryProgress', {
                            retry: selectedRequestInfo.retry,
                            maximum: selectedRequestInfo.maxRetries,
                          })}
                      </dd>
                    </div>
                  )}
                  {selectedRequestInfo.retryDelayMs !== undefined && (
                    <div>
                      <dt>{t('details.retryDelay')}</dt>
                      <dd>{formatDurationMs(selectedRequestInfo.retryDelayMs, t)}</dd>
                    </div>
                  )}
                  {selectedRequestResult !== undefined && (
                    <div>
                      <dt>{t('details.result')}</dt>
                      <dd className={css.overviewParentLinks}>
                        <button
                          type="button"
                          className={css.overviewHierarchyNavLink}
                          onClick={() => {
                            openRecordSummary(selectedRequestResult)
                          }}
                        >
                          <span>
                            {selectedRequestInfo.purpose === 'compaction'
                              ? t('details.compacted')
                              : t('details.assistantMessage')}
                          </span>
                          <IconChevronRightOutlineRegular
                            className={css.overviewHierarchyJumpIconTight}
                            size={11}
                          />
                        </button>
                      </dd>
                    </div>
                  )}
                </dl>
                <div className={css.overviewSections}>
                  {selectedRequestOptions !== undefined && (
                    <OverviewSection label={t('tab.options')} onOpen={() => { activateTab('options') }}>
                      <RequestOptions options={selectedRequestOptions} preview stringWrapping={stringWrapping} t={t} />
                    </OverviewSection>
                  )}
                  <OverviewSection label={t('tab.usage')} onOpen={() => { activateTab('usage') }}>
                    <UsageRows usage={selectedRequestUsage} t={t} />
                  </OverviewSection>
                  <OverviewSection label={t('tab.timing')} onOpen={() => { activateTab('timing') }}>
                    <RequestTiming
                      assistant={selectedRequestAssistant}
                      anchor={selectedRequestAnchor}
                      request={selectedRequestInfo}
                      preview
                      t={t}
                    />
                  </OverviewSection>
                </div>
              </>
            )}
            {selectedRequestInfo !== undefined && activeTab === 'options' && (
              <RequestOptions options={selectedRequestOptions} stringWrapping={stringWrapping} t={t} />
            )}
            {selectedRequestInfo !== undefined && activeTab === 'usage' && (
              <RequestUsagePanel
                usage={selectedRequestUsage}
                cumulative={selectedRequestCumulativeUsage}
                t={t}
              />
            )}
            {selectedRequestInfo !== undefined && activeTab === 'timing' && (
              <RequestTiming
                assistant={selectedRequestAssistant}
                anchor={selectedRequestAnchor}
                request={selectedRequestInfo}
                t={t}
              />
            )}
            {selectedPrompt !== undefined
              && selectedPreviousPrompt !== undefined
              && activeTab === 'diff' && (
              <SystemPromptDiff
                before={selectedPreviousPrompt}
                after={selectedPrompt}
                t={t}
              />
            )}
            {promptSelected && activeTab === 'system-prompt' && (
              selectedSystemPrompt === ''
                ? <p className={css.noPayload}>{t('record.systemPromptMissing')}</p>
                : (
                  <div className={`${css.markdownPayload} ${css.systemPrompt}`}>
                    <MarkdownText text={selectedSystemPrompt} labels={markdownLabels(t)} />
                  </div>
                )
            )}
            {selectedPrompt !== undefined && activeTab === 'tools' && (
              <ToolCatalog tools={selectedPrompt.tools} stringWrapping={stringWrapping} t={t} />
            )}
            {!promptSelected
              && selected?.cell.kind === 'compacted'
              && selectedState !== undefined
              && activeTab === 'overview' && (
              <>
                <dl
                  className={`${css.overview} ${css.summaryScrollRegion}`}
                  data-summary-scroll-region=""
                >
                  <div>
                    <dt>{t('details.status')}</dt>
                    <dd className={selectedState === 'error' ? css.error : undefined}>
                      {statusLabel(selectedState, t)}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('timing.duration')}</dt>
                    <dd>{formatElapsedSeconds(selected.cell.timeSeconds, t)}</dd>
                  </div>
                  <div>
                    <dt>{t('usage.tokens')}</dt>
                    <dd>—</dd>
                  </div>
                </dl>
                {selected.cell.outputDetail !== undefined && (
                  <div
                    className={`${css.compactedSummary} ${css.summaryScrollRegion}`}
                    data-summary-scroll-region=""
                  >
                    <MarkdownRecordContent
                      record={selected}
                      renderImages={renderImages}
                      rendered
                      thinkingExpanded={thinkingExpanded}
                      onThinkingExpandedChange={setThinkingExpanded}
                      onOpenCall={openCallSummary}
                      t={t}
                    />
                  </div>
                )}
              </>
            )}
            {!promptSelected
              && selected !== undefined
              && selected.cell.kind !== 'compacted'
              && selectedState !== undefined
              && activeTab === 'overview' && (
              <>
                {selectedProgram !== undefined && selectedProgram.description !== '' && (
                  <p className={css.programDescription}>{selectedProgram.description}</p>
                )}
                <dl
                  className={`${css.overview} ${css.summaryScrollRegion}`}
                  data-summary-scroll-region=""
                >
                  {selected.cell.messageSource !== undefined && (
                    <div>
                      <dt>{t('details.source')}</dt>
                      <dd className={css.overviewParentLinks}>
                        <button
                          type="button"
                          className={css.overviewHierarchyNavLink}
                          onClick={() => { activateTab('source') }}
                        >
                          <span>{messageSourceLabel(selected.cell.messageSource, t)}</span>
                          <IconChevronRightOutlineRegular
                            className={css.overviewHierarchyJumpIconTight}
                            size={11}
                          />
                        </button>
                      </dd>
                    </div>
                  )}
                  {hasSelectedHierarchy && (
                    <div>
                      <dt>
                        {selectedAssistantRequestTarget !== undefined
                          ? t('details.source')
                          : t('details.hierarchy')}
                      </dt>
                      <dd className={css.overviewParentLinks}>
                        {selectedAssistantRequestTarget !== undefined && (
                          <button
                            type="button"
                            className={css.overviewHierarchyNavLink}
                            onClick={() => {
                              selectRequest(selectedAssistantRequestTarget)
                            }}
                          >
                            <span>{t('request.label', { request: selectedAssistantRequest ?? '—' })}</span>
                            <IconChevronRightOutlineRegular
                              className={css.overviewHierarchyJumpIconTight}
                              size={11}
                            />
                          </button>
                        )}
                        {selectedParentMessage !== undefined && (
                          <button
                            type="button"
                            className={css.overviewHierarchyNavLink}
                            onClick={() => { openRecordSummary(selectedParentMessage) }}
                          >
                            <span>{t('details.assistantMessage')}</span>
                            <IconChevronRightOutlineRegular
                              className={css.overviewHierarchyJumpIconTight}
                              size={11}
                            />
                          </button>
                        )}
                        {selectedParentTool !== undefined && (
                          <button
                            type="button"
                            className={css.overviewHierarchyNavLink}
                            onClick={() => { openRecordSummary(selectedParentTool) }}
                          >
                            <span>{t('details.toolCall')}</span>
                            <IconChevronRightOutlineRegular
                              className={css.overviewHierarchyJumpIconTight}
                              size={11}
                            />
                          </button>
                        )}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>{t('details.status')}</dt>
                    <dd className={selectedState === 'error' ? css.error : undefined}>
                      {statusLabel(selectedState, t)}
                    </dd>
                  </div>
                  {selected.cell.kind === 'message' && (
                    <TokenRows cell={selected.cell} t={t} />
                  )}
                  {(selected.cell.kind === 'user' || selected.cell.kind === 'context') && (
                    <div>
                      <dt>{t('timing.duration')}</dt>
                      <dd>{formatElapsedSeconds(selected.cell.timeSeconds, t)}</dd>
                    </div>
                  )}
                </dl>
                <div className={css.overviewSections}>
                  {selectedProgram !== undefined
                    ? (
                      <>
                        <ProgramInput key={`preview:${selectedRecordId}`} program={selectedProgram}
                          initialWrapped={codeWrappingOnOpen}
                          stringWrapping={stringWrapping} onOpen={() => { activateTab('input') }} t={t} />
                        <ProgramOutput record={selected} stringWrapping={stringWrapping}
                          onOpen={() => { activateTab('output') }} t={t} />
                      </>
                    )
                    : isMarkdownRecord(selected)
                      ? (
                        <>
                          <OverviewSection label={t('tab.preview')} onOpen={() => { activateTab('rendered') }}>
                            <MarkdownRecordContent
                              record={selected}
                              renderImages={renderImages}
                              rendered
                              preview
                              thinkingExpanded={thinkingExpanded}
                              onThinkingExpandedChange={setThinkingExpanded}
                              onOpenCall={openCallSummary}
                              t={t}
                            />
                          </OverviewSection>
                        </>
                      )
                      : (
                        <>
                          {selected.cell.inputDetail && (
                            <OverviewSection label={t('tab.payload')} onOpen={() => { activateTab('input') }}>
                              <RecordPayload record={selected} direction="input" preview renderImages={renderImages} stringWrapping={stringWrapping} t={t} />
                            </OverviewSection>
                          )}
                          {selected.cell.outputDetail && (
                            <OverviewSection label={t('tab.result')} onOpen={() => { activateTab('output') }}>
                              <RecordPayload record={selected} direction="output" preview renderImages={renderImages} stringWrapping={stringWrapping} t={t} />
                            </OverviewSection>
                          )}
                          <OverviewSection label={t('tab.schema')} onOpen={() => { activateTab('schema') }}>
                            <RecordSchema record={selected} preview stringWrapping={stringWrapping} t={t} />
                          </OverviewSection>
                        </>
                      )}
                  {selectedAssistantRequestTarget !== undefined && (
                    <OverviewSection
                      label={t('timing.request')}
                      onOpen={() => {
                        selectRequest(selectedAssistantRequestTarget, 'timing')
                      }}
                    >
                      <RecordTiming record={selected} preview t={t} />
                    </OverviewSection>
                  )}
                  {(selected.cell.kind === 'tool' || selected.cell.kind === 'subtool') && (
                    <OverviewSection label={t('tab.timing')} onOpen={() => { activateTab('timing') }}>
                      <RecordTiming record={selected} preview t={t} />
                    </OverviewSection>
                  )}
                </div>
              </>
            )}
            {!promptSelected && selected !== undefined && activeTab === 'rendered' && (
              <MarkdownRecordContent
                record={selected}
                renderImages={renderImages}
                rendered
                thinkingExpanded={thinkingExpanded}
                onThinkingExpandedChange={setThinkingExpanded}
                onOpenCall={openCallSummary}
                t={t}
              />
            )}
            {!promptSelected && selected !== undefined && activeTab === 'raw' && (
              <MarkdownRecordContent
                record={selected}
                renderImages={renderImages}
                rendered={false}
                thinkingExpanded={thinkingExpanded}
                onThinkingExpandedChange={setThinkingExpanded}
                onOpenCall={openCallSummary}
                t={t}
              />
            )}
            {!promptSelected && selected !== undefined && activeTab === 'source' && (
              <MessageSource record={selected} stringWrapping={stringWrapping} t={t} />
            )}
            {!promptSelected && selected !== undefined && activeTab === 'input' && (
              selectedProgram === undefined
                ? <RecordPayload record={selected} direction="input" renderImages={renderImages} stringWrapping={stringWrapping} t={t} />
                : <ProgramInput key={`input:${selectedRecordId}`} program={selectedProgram}
                  initialWrapped={codeWrappingOnOpen}
                  stringWrapping={stringWrapping} t={t} />
            )}
            {!promptSelected && selected !== undefined && activeTab === 'output' && (
              selectedProgram === undefined
                ? <RecordPayload record={selected} direction="output" renderImages={renderImages} stringWrapping={stringWrapping} t={t} />
                : <ProgramOutput record={selected} stringWrapping={stringWrapping} t={t} />
            )}
            {!promptSelected && selected !== undefined && activeTab === 'schema' && (
              <RecordSchema record={selected} stringWrapping={stringWrapping} t={t} />
            )}
            {!promptSelected && selected !== undefined && activeTab === 'timing' && (
              <RecordTiming record={selected} t={t} />
            )}
          </div>
        </aside>
      )}
    </div>
  )
}
