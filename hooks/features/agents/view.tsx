// The Agents pane (screen F1) and its band row. Display only: pictures with see-through Clients on the
// desktop, text in the terminal. Pure: register.tsx hands in the elements, the state and the actions.

import type { RenderElement } from 'claude-code'
import { clickable, paneWidth, withAction, type Basic, type Pictured, type Presses } from '../../ui/click.tsx'
import { modelName } from '../../core/prices.ts'
import {
  bandOf, contextPercent, elapsed, fmtCost, fmtTime, fmtTokens, ordered, totals, type AgentRun, type AgentsState,
} from './model.ts'
import { BAND_H, ROW_H, bandSvg, emptySvg, headerSvg, runSvg, sectionSvg } from './pictures.ts'

export type AgentsActions = {
  toggleFinished: () => void
  /** ×N on the band: show or hide the pane. */
  togglePane: () => void
  /** ✕ on the band: hide the row for this group. */
  hideBand: () => void
}

const runAlt = (run: AgentRun, now: number) =>
  `${run.description}: ${run.status}, ${run.type}${run.model ? `, ${modelName(run.model)}` : ''}${run.effort ? ` ${run.effort}` : ''}, ` +
  `${run.steps} steps, context ${contextPercent(run)}%, ${fmtTokens(run.tokens)} tokens, ≈${fmtCost(run.costUsd)}, ${fmtTime(elapsed(run, now))}`

export function agentsDesktop(elements: Pictured, state: AgentsState, columns: number, actions: AgentsActions,
                              hover: string, presses: Presses): RenderElement {
  const { Box } = elements
  const width = paneWidth(columns)
  if (!state.runs.length) return <Box flexDirection="column">{clickable(elements, 'agents-empty', emptySvg(width), 'No agents yet', width, 70, [], presses)}</Box>
  const header = headerSvg(width, state)
  const sum = totals(state)
  const all = ordered(state.runs)
  const running = all.filter(run => run.status === 'running')
  const finished = all.filter(run => run.status !== 'running')
  const section = (key: string, label: string, toggle: string) => {
    const picture = sectionSvg(width, label, toggle, hover)
    return clickable(elements, key, picture.svg, label, width, 28, withAction(picture.parts, () => actions.toggleFinished()), presses)
  }
  const rows = (list: typeof all, prefix: string) => list.map((run, index) =>
    clickable(elements, `${prefix}:${run.id}`, runSvg(width, run, state.now, index === list.length - 1), runAlt(run, state.now), width, ROW_H, [], presses))
  return (
    <Box flexDirection="column">
      {clickable(elements, 'agents-head', header.svg,
        `${state.title}. Cost ${sum.isExact ? '' : 'about '}${fmtCost(sum.cost)}, ${fmtTokens(sum.tokens)} tokens, ${fmtTime(sum.time)}`,
        width, header.height, [], presses)}
      {running.length ? section('agents-running', `Running · ${running.length}`, '') : null}
      {rows(running, 'run')}
      {finished.length ? section('agents-finished', `${state.isFinishedOpen ? '▾' : '▸'} Finished · ${finished.length}`, 'agents:finished') : null}
      {state.isFinishedOpen ? rows(finished, 'done') : null}
    </Box>
  )
}

// ---- terminal and other text surfaces --------------------------------------------------------------

const textBar = (fraction: number, width: number) => {
  const filled = Math.round(Math.max(0, Math.min(1, fraction)) * width)
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`
}

export function agentsText(elements: Basic, state: AgentsState, actions: AgentsActions): RenderElement {
  const { Box, Button, Text } = elements
  if (!state.runs.length) return <Text dimColor>No agents yet. When Claude starts subagents, they show here as they work.</Text>
  const sum = totals(state)
  const all = ordered(state.runs)
  const running = all.filter(run => run.status === 'running')
  const finished = all.filter(run => run.status !== 'running')
  const row = (run: (typeof all)[number]) => (
    <Box key={run.id} flexDirection="column" marginLeft={Math.min(3, run.depth) * 2}>
      <Box flexDirection="row" gap={1}>
        <Text bold>{run.description}</Text>
        {run.round > 1 ? <Text dimColor>{`round ${run.round}`}</Text> : null}
        {run.status === 'done' ? <Text color="success">✓</Text> : null}
        {run.status === 'stopped' ? <Text dimColor>stopped</Text> : null}
        {run.status === 'failed' ? <Text color="error">{`failed: ${run.failure ?? 'error'}`}</Text> : null}
      </Box>
      <Text dimColor>{[run.type, run.model ? modelName(run.model) : '', run.effort ?? ''].filter(Boolean).join(' · ')}</Text>
      <Text dimColor>{`${run.steps} steps · ctx ${contextPercent(run)}% · ${fmtTokens(run.tokens)} ≈${fmtCost(run.costUsd)} ${fmtTime(elapsed(run, state.now))}`}</Text>
    </Box>
  )
  return (
    <Box flexDirection="column">
      <Text bold>{state.title || 'Agents'}</Text>
      <Text>{`Cost ${sum.isExact ? '' : '≈'}${fmtCost(sum.cost)} · Tokens ${fmtTokens(sum.tokens)} · Time ${fmtTime(sum.time)}`}</Text>
      {running.length ? <Text dimColor bold>{`RUNNING · ${running.length}`}</Text> : null}
      {running.map(row)}
      {finished.length
        ? <Button key="agents:finished" plain label={`${state.isFinishedOpen ? '▾' : '▸'} FINISHED · ${finished.length}`} onPress={actions.toggleFinished} />
        : null}
      {state.isFinishedOpen ? finished.map(row) : null}
    </Box>
  )
}

/** The band row while agents run: one picture on the desktop; `█░` text and two Buttons in the terminal. */
export function agentsBand(elements: Basic | Pictured, isDesktop: boolean, state: AgentsState, columns: number, actions: AgentsActions,
                           hover: string, presses: Presses): RenderElement | null {
  const band = bandOf(state)
  if (!band) return null
  if (isDesktop && 'Svg' in elements) {
    const width = paneWidth(columns)
    const picture = bandSvg(width, band, hover)
    return clickable(elements, 'band-agents', picture.svg, `${band.title}: ${band.label}, ${band.running} running`, width, BAND_H,
      withAction(picture.parts, key => (key === 'band:agents-hide' ? actions.hideBand() : actions.togglePane())), presses)
  }
  const { Box, Button, Text } = elements
  return (
    <Box key="band-agents" flexDirection="row" gap={1}>
      <Text color="suggestion">●</Text>
      <Text bold>{band.title}</Text>
      <Text color="suggestion">{textBar(band.fraction, 16)}</Text>
      <Text dimColor>{band.label}</Text>
      <Button key="band:agents" plain label={`×${band.running}`} onPress={actions.togglePane} />
      <Button key="band:agents-hide" plain label="✕" onPress={actions.hideBand} />
    </Box>
  )
}
