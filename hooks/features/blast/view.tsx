// The Blast Radius pane (screen F5): pictures with see-through Clients on the desktop, text with real
// Buttons (1 runs it, 2 cancels, focused) in the terminal and in the band's card slot. Pure.

import type { RenderElement } from 'claude-code'
import { clickable, paneWidth, withAction, type Basic, type Pictured, type Presses } from '../../ui/click.tsx'
import type { RiskKind } from './classify.ts'
import { countdown, visibleRows, type BlastHeld } from './model.ts'
import { actionsSvg, reportSvg } from './pictures.ts'

export type BlastActions = {
  proceed: () => void
  cancel: () => void
  toggleMore: () => void
}

function run(actions: BlastActions, key: string): void {
  if (key === 'blast:proceed') actions.proceed()
  else if (key === 'blast:cancel') actions.cancel()
  else if (key === 'blast:more') actions.toggleMore()
}

/** The keys the pane answers once it has the keyboard: 1 runs it, 2 (or c) cancels. */
export function blastKey(actions: BlastActions, key: string): boolean {
  if (key === '1') actions.proceed()
  else if (key === '2' || key === 'c') actions.cancel()
  else return false
  return true
}

export function blastDesktop(elements: Pictured, held: BlastHeld, kind: RiskKind, queued: number, columns: number,
                             actions: BlastActions, hover: string, presses: Presses): RenderElement {
  const { Box } = elements
  const width = paneWidth(columns)
  const card = reportSvg(width, held, kind)
  const decision = actionsSvg(width, held, queued, hover)
  const report = held.report
  const alt = report
    ? `${report.command} ${report.verb} ${report.amount}. ${report.where}. ${report.warn} ${visibleRows(report, held.isExpanded).rows.map(row => row.name).join(', ')}`
    : 'Measuring what this would change'
  return (
    <Box flexDirection="column" gap={1}>
      {clickable(elements, 'blast-report', card.svg, alt, width, card.height, withAction(card.parts, key => run(actions, key)), presses)}
      {clickable(elements, 'blast-actions', decision.svg, report ? `${report.action}, Cancel` : '', width, decision.height,
        withAction(decision.parts, key => run(actions, key)), presses)}
    </Box>
  )
}

export function blastText(elements: Basic, held: BlastHeld, queued: number, actions: BlastActions): RenderElement {
  const { Box, Button, Text } = elements
  const report = held.report
  if (!report) return <Text dimColor>Blast Radius: measuring what this would change…</Text>
  const { rows, hidden, moreLine } = visibleRows(report, held.isExpanded)
  const struck = new Set(held.struck)
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="error" paddingX={1}>
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        <Text bold>{report.command}</Text>
        <Text dimColor>{report.verb}</Text>
        <Text color="error" bold>{report.amount}</Text>
      </Box>
      <Text dimColor>{[report.where, held.agent ? `from agent ${held.agent}` : ''].filter(Boolean).join(' · ')}</Text>
      {report.warn ? <Text color="error">{`⚠ ${report.warn}`}</Text> : null}
      {rows.map((row, index) => (
        <Box key={`r${index}`} flexDirection="row" gap={1}>
          <Text bold={row.kind === 'folder'} strikethrough={struck.has(row.path)} dimColor={struck.has(row.path)} wrap="truncate-end">
            {`${row.isIndented ? '    ' : '  '}${row.name}`}
          </Text>
          {row.count ? <Text dimColor>{row.count}</Text> : null}
          {row.size ? <Text dimColor={row.kind !== 'folder'}>{row.size}</Text> : null}
        </Box>
      ))}
      {moreLine ? <Text dimColor>{`  ${moreLine}`}</Text> : null}
      {hidden > 0 ? <Button key="blast:more" plain label={`Show ${hidden} more`} onPress={actions.toggleMore} /> : null}
      {report.note ? <Text dimColor>{report.note}</Text> : null}
      {held.phase === 'waiting' ? (
        <Box flexDirection="row" gap={2} marginTop={1}>
          <Button key="blast:proceed" label={report.action} hotkey="1" onPress={actions.proceed} />
          <Button key="blast:cancel" label="Cancel" hotkey="2" autoFocus onPress={actions.cancel} />
          <Text dimColor>{`${countdown(held) ? `Runs by itself in ${countdown(held)}` : 'Held by Blast Radius'}${queued ? ` · ${queued} more held` : ''}`}</Text>
        </Box>
      ) : (
        <Text color={held.phase === 'done' ? 'success' : held.phase === 'refused' ? 'error' : undefined} dimColor={held.phase === 'running'}>
          {held.phase === 'running' ? 'Running it…' : held.phase === 'done' ? 'Done' : held.phase === 'refused' ? "Didn't run" : 'Measuring…'}
        </Text>
      )}
    </Box>
  )
}

/**
 * The row above the prompt while a command is held, whatever the pane does: what is held, the action
 * (key 1) and Cancel (key 2, focused). If the side pane is hidden or closed, this still answers it.
 */
export function blastRow(elements: Basic, held: BlastHeld, queued: number, actions: BlastActions): RenderElement | null {
  const { Box, Button, Text } = elements
  const report = held.report
  if (!report || held.phase !== 'waiting') return null
  return (
    <Box key="blast-row" flexDirection="row" gap={1} flexWrap="wrap">
      <Text color="error" bold>⚠ Blast Radius is holding</Text>
      <Text bold>{report.command}</Text>
      <Text dimColor>{report.verb}</Text>
      <Text color="error">{report.amount}</Text>
      {countdown(held) ? <Text dimColor>{`· runs by itself in ${countdown(held)}`}</Text> : null}
      {queued ? <Text dimColor>{`· ${queued} more held`}</Text> : null}
      <Button key="blast:proceed" label={report.action} hotkey="1" onPress={actions.proceed} />
      <Button key="blast:cancel" label="Cancel" hotkey="2" autoFocus onPress={actions.cancel} />
    </Box>
  )
}
