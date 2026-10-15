// Auto on screen: the rule card and the send check above the prompt in the Inbox session, the Auto row
// under them, and the Auto pane (screens 5 and 7). Pictures with see-through Clients on the desktop,
// text with real Buttons in the terminal. Pure.

import type { ElementConstructor, InputProps, RenderElement } from 'claude-code'
import { clickable, paneWidth, type Basic, type Hit, type Pictured, type Presses } from '../../ui/click.tsx'
import { sectionSvg, type Part } from '../../ui/kit.ts'
import { ROW_PX } from '../../ui/theme.ts'
import {
  bandText, checksOf, clock, doneToday, onlyIf, rightNowText, ruleSummary, sourcesText, taskText, waitingFor, whatGoes, UNDOABLE,
  type AutoDraft, type AutoRule, type AutoState, type AutoTask,
} from './model.ts'
import { autoRowSvg, checkCardSvg, logSvg, plannedText, rightNowSvg, ruleCardSvg, rulesSvg, tasksSvg, whereText } from './pictures.ts'
import type { InboxItem } from '../inbox/model.ts'

export type AutoActions = {
  /** The rule card. */
  ruleMode: (mode: 'ask' | 'auto') => void
  saveRule: () => void
  editRule: () => void
  dismissRule: () => void
  /** The send check. */
  send: () => void
  startEdit: () => void
  submitEdit: (text: string) => void
  cancelEdit: () => void
  skip: () => void
  /** The pane and the row. */
  open: () => void
  toggle: () => void
  pause: () => void
  resume: () => void
  stop: (taskId: string) => void
  check: (taskId: string) => void
  cycleMode: (ruleId: string) => void
  undo: (actionId: string) => void
}

type WithInput = { Input: ElementConstructor<InputProps> }

const widthOf = (columns: number) => paneWidth(columns)

function run(actions: AutoActions, key: string): void {
  if (key.startsWith('auto:rule:mode:')) actions.ruleMode(key.endsWith(':auto') ? 'auto' : 'ask')
  else if (key === 'auto:rule:save') actions.saveRule()
  else if (key === 'auto:rule:edit') actions.editRule()
  else if (key === 'auto:rule:dismiss' || key === 'auto:rule:done') actions.dismissRule()
  else if (key === 'auto:rule:open' || key === 'auto:open') actions.open()
  else if (key === 'auto:check:send') actions.send()
  else if (key === 'auto:check:edit') actions.startEdit()
  else if (key === 'auto:check:skip') actions.skip()
  else if (key.startsWith('auto:check:')) actions.check(key.slice('auto:check:'.length))
  else if (key.startsWith('auto:stop:')) actions.stop(key.slice('auto:stop:'.length))
  else if (key.startsWith('auto:mode:')) actions.cycleMode(key.slice('auto:mode:'.length))
  else if (key.startsWith('auto:undo:')) actions.undo(key.slice('auto:undo:'.length))
  else if (key === 'auto:toggle') actions.toggle()
  else if (key === 'auto:pause') actions.pause()
  else if (key === 'auto:resume') actions.resume()
}

const withAction = (parts: readonly Part[], actions: AutoActions): Hit[] =>
  parts.map(part => ({ ...part, onPress: () => run(actions, part.key) }))

// ---- Above the prompt ------------------------------------------------------------------------------

const pairText = (rule: AutoRule) => rule.pairs.map(pair => `${pair.whenText} → ${pair.doText}`).join('; ')

/** The rule /sb-auto made, waiting for Save rule. */
export function ruleBand(elements: Basic | Pictured, isDesktop: boolean, draft: AutoDraft, columns: number, actions: AutoActions,
                         hover: string, presses: Presses): RenderElement {
  const { Box } = elements
  const rule = draft.rule
  if (isDesktop && 'Svg' in elements) {
    const width = widthOf(columns)
    const card = ruleCardSvg(width, draft, hover)
    const alt = rule && draft.phase !== 'making'
      ? `Rule ${rule.name}, ${rule.mode === 'auto' ? 'Auto' : 'Ask first'}: ${pairText(rule)}. Only if ${onlyIf(rule).join(', ')}.`
      : draft.phase === 'error' ? `Couldn't make a rule: ${draft.error}` : 'Making the rule'
    return <Box key="auto-rule" flexDirection="column">{clickable(elements, 'auto-rule', card.svg, alt, width, card.height, withAction(card.parts, actions), presses)}</Box>
  }
  const { Button, Text } = elements
  if (!rule || draft.phase === 'making' || draft.phase === 'error') {
    return (
      <Box key="auto-rule" flexDirection="column" borderStyle="round" borderColor={draft.phase === 'error' ? 'error' : 'warning'} paddingX={1}>
        <Text bold>{draft.phase === 'error' ? `Couldn't make a rule: ${draft.error}` : 'Making the rule…'}</Text>
        <Text dimColor wrap="truncate-end">{draft.request}</Text>
        {draft.phase === 'error' ? <Button key="auto:rule:dismiss" label="Dismiss" onPress={actions.dismissRule} /> : null}
      </Box>
    )
  }
  return (
    <Box key="auto-rule" flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1}>
      <Text bold>{`${rule.name} · ${sourcesText(rule)}`}</Text>
      {rule.pairs.map((pair, index) => <Text key={`pair-${index}`}>{`  ${pair.whenText} → ${pair.doText}`}</Text>)}
      <Text dimColor>{`Only if ${onlyIf(rule).join(' · ')}`}</Text>
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        <Button key="auto:rule:mode:ask" plain label={`${rule.mode === 'ask' ? '●' : '○'} Ask first`} onPress={() => actions.ruleMode('ask')} />
        <Button key="auto:rule:mode:auto" plain label={`${rule.mode === 'auto' ? '●' : '○'} Auto`} onPress={() => actions.ruleMode('auto')} />
      </Box>
      {draft.phase === 'saved' ? (
        <Box flexDirection="row" gap={1}>
          <Text color="success">{`✓ Rule active · ${rule.mode === 'auto' ? 'Auto' : 'Ask first'}`}</Text>
          <Button key="auto:rule:open" label="Open Auto" onPress={actions.open} />
          <Button key="auto:rule:done" label="Done" autoFocus onPress={actions.dismissRule} />
        </Box>
      ) : (
        <Box flexDirection="row" gap={1}>
          <Button key="auto:rule:save" label="Save rule" hotkey="1" autoFocus onPress={actions.saveRule} />
          <Button key="auto:rule:edit" label="Edit" hotkey="2" onPress={actions.editRule} />
          <Button key="auto:rule:dismiss" label="Cancel" hotkey="3" onPress={actions.dismissRule} />
        </Box>
      )}
    </Box>
  )
}

/** The held action (screen 5): what goes to whom, the checks, Send / Edit first / Don't send. */
export function checkBand(elements: (Basic | Pictured) & WithInput, isDesktop: boolean, state: AutoState, task: AutoTask, rule: AutoRule | null,
                          item: InboxItem | null, now: number, columns: number, maxRows: number, actions: AutoActions, hover: string,
                          presses: Presses): RenderElement {
  const { Box, Input } = elements
  if (state.isEditing && task.do === 'reply') {
    return (
      <Box key="auto-check" flexDirection="column" gap={1}>
        <Input key="auto-check-edit" label={`Reply to ${item?.from.name ?? 'them'}`} value={taskText(task)} submitLabel="done" autoFocus
               onSubmit={value => actions.submitEdit(value)} />
        <elements.Button key="auto:check:cancel" plain label="Cancel" onPress={actions.cancelEdit} />
      </Box>
    )
  }
  const what = `${task.ruleName} wants to send ${whatGoes(task)} ${whereText(task, item)}`
  if (isDesktop && 'Svg' in elements) {
    const width = widthOf(columns)
    let card = checkCardSvg(width, state, task, rule, item, now, hover, false)
    if (card.height > maxRows * ROW_PX) card = checkCardSvg(width, state, task, rule, item, now, hover, true)
    const checks = checksOf(state, task, rule, item, now).map(one => `${one.isOk ? '✓' : '✗'} ${one.text.replace('|', ' ')}`).join(', ')
    return (
      <Box key="auto-check" flexDirection="column">
        {clickable(elements, 'auto-check', card.svg, `${what}: “${task.do === 'reply' ? taskText(task) : plannedText(task, rule)}”. ${checks}. Send, Edit first, Don't send.`,
          width, card.height, withAction(card.parts, actions), presses)}
      </Box>
    )
  }
  const { Button, Text } = elements
  return (
    <Box key="auto-check" flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1}>
      <Text bold wrap="wrap">{what}</Text>
      <Text color="warning">This rule is set to Ask first, so nothing goes out until you say so.</Text>
      <Text wrap="wrap">{`“${task.do === 'reply' ? taskText(task) : plannedText(task, rule)}”`}</Text>
      {checksOf(state, task, rule, item, now).map((one, index) => (
        <Text key={`check-${index}`} color={one.isOk ? 'success' : 'error'}>{`${one.isOk ? '✓' : '✗'} ${one.text.replace('|', ': ')}`}</Text>
      ))}
      {task.state === 'sending' ? <Text dimColor>Sending…</Text> : (
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Button key="auto:check:send" label={task.do === 'reply' ? 'Send reply' : 'Do it'} hotkey="1" onPress={actions.send} />
          {task.do === 'reply' ? <Button key="auto:check:edit" label="Edit first" hotkey="2" onPress={actions.startEdit} /> : null}
          <Button key="auto:check:skip" label="Don't send" hotkey="3" autoFocus onPress={actions.skip} />
        </Box>
      )}
    </Box>
  )
}

/** The Inbox session's Auto row: "AUTO · 1 running · 1 waiting · 7 rules on", Open Auto, Pause all. */
export function autoRow(elements: Basic | Pictured, isDesktop: boolean, state: AutoState, columns: number, actions: AutoActions,
                        hover: string, presses: Presses): RenderElement | null {
  if (!state.rules.length) return null
  const text = bandText(state)
  if (isDesktop && 'Svg' in elements) {
    const width = widthOf(columns)
    const row = autoRowSvg(width, state, text, hover)
    return clickable(elements, 'auto-row', row.svg, `Auto: ${text}. Open Auto, ${state.isPaused ? 'Resume' : 'Pause all'}`, width, row.height,
      withAction(row.parts, actions), presses)
  }
  const { Box, Button, Text } = elements
  return (
    <Box key="auto-row" flexDirection="row" gap={1}>
      <Text color={state.isPaused ? undefined : 'warning'} dimColor={state.isPaused} bold>● Auto</Text>
      <Text dimColor wrap="truncate-end">{text}</Text>
      <Button key="auto:open" plain label="Open Auto" onPress={actions.open} />
      {state.isPaused ? <Button key="auto:resume" plain label="Resume" onPress={actions.resume} />
        : <Button key="auto:pause" plain label="Pause all" onPress={actions.pause} />}
    </Box>
  )
}

// ---- The pane --------------------------------------------------------------------------------------

const live = (state: AutoState) => state.tasks.filter(task => ['running', 'sending', 'waiting'].includes(task.state))

export function autoDesktop(elements: Pictured, state: AutoState, now: number, columns: number, actions: AutoActions, hover: string,
                            presses: Presses): RenderElement {
  const { Box } = elements
  const width = widthOf(columns)
  const top = rightNowSvg(width, state, now, hover)
  const tasks = tasksSvg(width, live(state), now, hover)
  const rules = rulesSvg(width, state.rules, hover)
  const log = logSvg(width, state.log, hover)
  return (
    <Box flexDirection="column" gap={1}>
      {clickable(elements, 'auto-now', top.svg, `Right now: ${rightNowText(state)}. ${doneToday(state, now)} done today. Auto mode ${state.isOn ? 'on' : 'off'}. ${state.isPaused ? 'Resume' : 'Pause all'}`,
        width, top.height, withAction(top.parts, actions), presses)}
      {clickable(elements, 'auto-tasks', tasks.svg, live(state).map(task => `${task.title}: ${task.state}`).join('; ') || 'Nothing running or waiting',
        width, tasks.height, withAction(tasks.parts, actions), presses)}
      {clickable(elements, 'auto-rules-head', sectionSvg(width, 'Rules', String(state.rules.length)), 'Rules', width, 26, [], presses)}
      {clickable(elements, 'auto-rules', rules.svg, state.rules.map(rule => `${rule.name}: ${ruleSummary(rule)}, ${rule.isOn ? rule.mode === 'auto' ? 'Auto' : 'Ask first' : 'Off'}`).join('; ') || 'No rules yet',
        width, rules.height, withAction(rules.parts, actions), presses)}
      {clickable(elements, 'auto-log-head', sectionSvg(width, 'Today', 'Undo where it can'), 'Today', width, 26, [], presses)}
      {clickable(elements, 'auto-log', log.svg, state.log.slice(0, 20).map(entry => `${clock(entry.at)} ${entry.text}`).join('; ') || 'Nothing done yet today',
        width, log.height, withAction(log.parts, actions), presses)}
    </Box>
  )
}

export function autoText(elements: Basic, state: AutoState, now: number, actions: AutoActions): RenderElement {
  const { Box, Button, Text } = elements
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column" borderStyle="round" paddingX={1}>
        <Text color="warning" bold>● RIGHT NOW</Text>
        <Text bold>{rightNowText(state)}</Text>
        <Text dimColor>{`${doneToday(state, now)} done today · $${state.costToday.toFixed(2)} on Haiku 4.5`}</Text>
        <Box flexDirection="row" gap={1}>
          <Button key="auto:toggle" plain label={`Auto mode: ${state.isOn ? 'on' : 'off'}`} onPress={actions.toggle} />
          {state.isPaused ? <Button key="auto:resume" label="Resume" onPress={actions.resume} /> : <Button key="auto:pause" label="Pause all" onPress={actions.pause} />}
        </Box>
      </Box>
      {live(state).map(task => (
        <Box key={task.id} flexDirection="row" gap={1}>
          <Text wrap="truncate-end">{`${task.title} · ${task.state === 'waiting' ? waitingFor(task, now) : task.state}`}</Text>
          {task.state === 'waiting' ? <Button key={`auto:check:${task.id}`} label="Check" onPress={() => actions.check(task.id)} />
            : <Button key={`auto:stop:${task.id}`} label="Stop" onPress={() => actions.stop(task.id)} />}
        </Box>
      ))}
      <Text bold>{`RULES · ${state.rules.length}`}</Text>
      {state.rules.length ? state.rules.map(rule => (
        <Box key={rule.id} flexDirection="row" gap={1}>
          <Text wrap="truncate-end">{`${rule.name} · ${ruleSummary(rule)}`}</Text>
          <Button key={`auto:mode:${rule.id}`} plain label={rule.isOn ? rule.mode === 'auto' ? '[Auto]' : '[Ask first]' : '[Off]'} onPress={() => actions.cycleMode(rule.id)} />
        </Box>
      )) : <Text dimColor>No rules yet. Type /sb-auto and say what to do.</Text>}
      <Text bold>TODAY</Text>
      {state.log.length ? state.log.slice(0, 20).map((entry, index) => (
        <Box key={`log-${index}`} flexDirection="row" gap={1}>
          <Text dimColor>{clock(entry.at)}</Text>
          <Text wrap="truncate-end" dimColor={entry.isUndone}>{entry.text}</Text>
          {entry.actionId && UNDOABLE.has(entry.undo) && !entry.isUndone
            ? <Button key={`auto:undo:${entry.actionId}`} plain label="Undo" onPress={() => actions.undo(entry.actionId)} /> : null}
        </Box>
      )) : <Text dimColor>Nothing done yet today.</Text>}
    </Box>
  )
}
