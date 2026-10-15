// The Replay pane (screen F4), opened with /sb-replay: pictures with see-through Clients on the
// desktop, text with real Buttons (p, n, c) in the terminal. Pure: register.tsx hands in the
// elements, the state and the actions.

import type { RenderElement } from 'claude-code'
import { clickable, paneWidth, withAction, type Basic, type Pictured, type Presses } from '../../ui/click.tsx'
import { sectionSvg } from '../../ui/kit.ts'
import { basename } from '../files/paths.ts'
import { withWords } from './diff.ts'
import { SHOWN_LINES, currentTurn, headline, plural, stepNotes, stepWhere, summaryOf, type ReplayState } from './model.ts'
import { editSvg, emptySvg, headerSvg, navSvg, timelineSvg } from './pictures.ts'

export type ReplayActions = {
  go: (step: number) => void
  showFull: () => void
  showTurn: (turn: number) => void
  close: () => void
}

/** What each part key does. */
function run(state: ReplayState, actions: ReplayActions, key: string): void {
  if (key.startsWith('step:')) actions.go(Number(key.slice('step:'.length)))
  else if (key === 'replay:prev') actions.go(state.step - 1)
  else if (key === 'replay:next') actions.go(state.step + 1)
  else if (key === 'replay:full') actions.showFull()
  else if (key === 'replay:new') actions.showTurn(0)
  else if (key === 'turn:older') actions.showTurn(state.turn + 1)
  else if (key === 'turn:newer') actions.showTurn(state.turn - 1)
}

/** The keys the pane answers once it has the keyboard (a click gives it): p, n, c and the arrows. */
export function replayKey(state: ReplayState, actions: ReplayActions, key: string): boolean {
  if (key === 'p' || key === 'left' || key === 'up') actions.go(state.step - 1)
  else if (key === 'n' || key === 'right' || key === 'down') actions.go(state.step + 1)
  else if (key === 'c') actions.close()
  else return false
  return true
}

export function replayDesktop(elements: Pictured, state: ReplayState, columns: number, actions: ReplayActions,
                              hover: string, presses: Presses): RenderElement {
  const { Box } = elements
  const width = paneWidth(columns)
  const turn = currentTurn(state)
  if (!turn) return <Box flexDirection="column">{clickable(elements, 'replay-empty', emptySvg(width), 'No edits yet', width, 84, [], presses)}</Box>
  const act = (key: string) => run(state, actions, key)
  const header = headerSvg(width, state, hover)
  const timeline = timelineSvg(width, turn.steps, state.step, hover)
  const edit = editSvg(width, state, hover)
  const nav = navSvg(width, state, hover)
  const step = turn.steps[state.step]
  const summary = summaryOf(turn)
  return (
    <Box flexDirection="column" gap={1}>
      {clickable(elements, 'replay-head', header.svg, `${headline(summary)}. ${summary.add} lines added, ${summary.del} removed.`,
        width, header.height, withAction(header.parts, act), presses)}
      {clickable(elements, 'replay-section', sectionSvg(width, 'The edits, in order'), 'The edits, in order', width, 26, [], presses)}
      {clickable(elements, 'replay-steps', timeline.svg,
        turn.steps.map((one, index) => `${index + 1}. ${one.path} +${one.add} −${one.del}`).join('\n'), width, timeline.height,
        withAction(timeline.parts, act), presses)}
      {clickable(elements, 'replay-edit', edit.svg,
        step ? `Edit ${state.step + 1} of ${turn.steps.length}: ${stepWhere(step)}` : '', width, edit.height, withAction(edit.parts, act), presses)}
      {clickable(elements, 'replay-nav', nav.svg, 'Previous edit, Next edit', width, nav.height, withAction(nav.parts, act), presses)}
    </Box>
  )
}

// ---- terminal and other text surfaces --------------------------------------------------------------

export function replayText(elements: Basic, state: ReplayState, actions: ReplayActions): RenderElement {
  const { Box, Button, Text } = elements
  const turn = currentTurn(state)
  if (!turn) return <Text dimColor>No edits yet. After a turn that edits files, its edits show here.</Text>
  const summary = summaryOf(turn)
  const step = turn.steps[state.step]
  const lines = step ? withWords(step.lines) : []
  const shown = state.isFull ? lines : lines.slice(0, SHOWN_LINES)
  return (
    <Box flexDirection="column">
      <Text bold>{headline(summary)}</Text>
      <Box flexDirection="row" gap={1}>
        <Text color="success">{`${plural(summary.add, 'line')} added,`}</Text>
        <Text color="error">{`${summary.del} removed`}</Text>
        {state.hasNew ? <Button key="new" plain label="New edits ready" onPress={() => actions.showTurn(0)} /> : null}
      </Box>
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {turn.steps.map((one, index) => (
          <Button key={`s${index}`} plain label={`${index === state.step ? '●' : '○'} ${index + 1} ${basename(one.path)}`}
                  onPress={() => actions.go(index)} />
        ))}
      </Box>
      {step ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color="claude" bold>{`EDIT ${state.step + 1} OF ${turn.steps.length}`}</Text>
          <Text bold>{basename(step.path)}</Text>
          <Text dimColor>{stepWhere(step)}</Text>
          {stepNotes(step).map(note => <Text key={note} color="warning">{note}</Text>)}
          <Box flexDirection="column" marginTop={1}>
            {step.kind === 'binary' ? <Text dimColor>Binary file changed</Text> : null}
            {shown.map((line, index) => (
              <Text key={`d${index}`} color={line.op === '+' ? 'success' : line.op === '-' ? 'error' : undefined}
                    dimColor={line.op === ' ' || line.op === '~'} wrap="truncate-end">
                {line.op === '~' ? '  ⋯' : `${line.op === '-' ? '−' : line.op} ${line.text}`}
              </Text>
            ))}
            {lines.length > shown.length
              ? <Button key="full" plain label={`Show full diff (${plural(lines.length - shown.length, 'more line')})`} onPress={actions.showFull} />
              : null}
          </Box>
        </Box>
      ) : null}
      <Box flexDirection="row" gap={2} marginTop={1}>
        <Button key="prev" label="Previous edit" hotkey="p" onPress={() => actions.go(state.step - 1)} />
        <Button key="next" label="Next edit" hotkey="n" autoFocus onPress={() => actions.go(state.step + 1)} />
        <Button key="close" label="Close" hotkey="c" onPress={actions.close} />
      </Box>
      {state.turns.length > 1 ? (
        <Box flexDirection="row" gap={1}>
          <Text dimColor>{`Turn ${state.turn + 1} of ${state.turns.length}`}</Text>
          {state.turn < state.turns.length - 1 ? <Button key="older" plain label="Earlier" onPress={() => actions.showTurn(state.turn + 1)} /> : null}
          {state.turn > 0 ? <Button key="newer" plain label="Later" onPress={() => actions.showTurn(state.turn - 1)} /> : null}
        </Box>
      ) : null}
    </Box>
  )
}
