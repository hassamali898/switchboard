// Reflect's card above the prompt (screen F6): pictures with see-through Clients on the desktop, text
// with real Buttons (1 save here, 2 save for all, 3 reword, 4 don't save) in the terminal. Reword is
// the app's own text field, prefilled with the rule. Pure: register.tsx hands in what it needs.

import type { ElementConstructor, InputProps, RenderElement } from 'claude-code'
import { clickable, paneWidth, withAction, type Basic, type Pictured, type Presses } from '../../ui/click.tsx'
import { buttonRow } from '../../ui/kit.ts'
import { ROW_PX } from '../../ui/theme.ts'
import { sureText, type ReflectScope } from './model.ts'
import { buttonsSvg, cardSvg, compactSvg, type CardInput } from './pictures.ts'

export type ReflectActions = {
  save: (scope: ReflectScope) => void
  choose: (scope: ReflectScope) => void
  startReword: () => void
  submitReword: (rule: string) => void
  cancelReword: () => void
  skip: () => void
}

type WithInput = { Input: ElementConstructor<InputProps> }

function run(actions: ReflectActions, key: string): void {
  if (key === 'reflect:save:project') actions.save('project')
  else if (key === 'reflect:save:global') actions.save('global')
  else if (key === 'reflect:opt:project') actions.choose('project')
  else if (key === 'reflect:opt:global') actions.choose('global')
  else if (key === 'reflect:reword') actions.startReword()
  else if (key === 'reflect:skip') actions.skip()
  else if (key === 'reflect:reword-cancel') actions.cancelReword()
}

/**
 * The card, or while rewording, the rule in a text field with Save and Cancel. On the desktop the full
 * card (F6) shows when it fits the band's `maxRows`; a lower band gets the compact card, buttons inside,
 * so the whole card is in view and nothing scrolls.
 */
export function reflectCard(elements: (Basic | Pictured) & WithInput, isDesktop: boolean, input: CardInput, more: number, isRewording: boolean,
                            columns: number, maxRows: number, actions: ReflectActions, hover: string, presses: Presses): RenderElement {
  const { Box, Input } = elements
  const act = (key: string) => run(actions, key)
  const field = (
    <Input key="reflect-reword" label="Rule" value={input.item.rule} submitLabel="save" autoFocus
           onSubmit={value => actions.submitReword(value)} />
  )
  if (isDesktop && 'Svg' in elements) {
    const width = paneWidth(columns)
    if (isRewording) {
      const row = buttonRow(width, [{ key: 'reflect:reword-cancel', label: 'Cancel' }], hover)
      return (
        <Box key="reflect" flexDirection="column" gap={1}>
          {field}
          {clickable(elements, 'reflect-reword-row', row.svg, 'Cancel', width, row.height, withAction(row.parts, act), presses)}
        </Box>
      )
    }
    const alt = `Save this as a rule? ${sureText(input.item.confidence)}. ${input.item.rule}${input.item.count > 1 ? ` (said ${input.item.count} times)` : ''}`
    const card = cardSvg(width, input, hover)
    const buttons = buttonsSvg(width, input.scope, more, hover)
    if (card.height + ROW_PX + buttons.height > maxRows * ROW_PX) {
      const compact = compactSvg(width, input, more, hover)
      return (
        <Box key="reflect" flexDirection="column">
          {clickable(elements, 'reflect-card', compact.svg, `${alt}. Save for this project, Save for all projects, Reword, Don't save`,
            width, compact.height, withAction(compact.parts, act), presses)}
        </Box>
      )
    }
    return (
      <Box key="reflect" flexDirection="column" gap={1}>
        {clickable(elements, 'reflect-card', card.svg, alt, width, card.height, withAction(card.parts, act), presses)}
        {clickable(elements, 'reflect-buttons', buttons.svg, 'Save for this project, Save for all projects, Reword, Don\'t save',
          width, buttons.height, withAction(buttons.parts, act), presses)}
      </Box>
    )
  }
  const { Button, Text } = elements
  if (isRewording) {
    return (
      <Box key="reflect" flexDirection="column">
        {field}
        <Button key="reflect:reword-cancel" plain label="Cancel" onPress={actions.cancelReword} />
      </Box>
    )
  }
  return (
    <Box key="reflect" flexDirection="column" borderStyle="round" borderColor="success" paddingX={1}>
      <Box flexDirection="row" gap={1}>
        <Text color="success" bold>● SAVE THIS AS A RULE?</Text>
        {input.item.count > 1 ? <Text color="success">{`×${input.item.count}`}</Text> : null}
        <Text dimColor>{sureText(input.item.confidence)}</Text>
      </Box>
      <Text bold>{`“${input.item.rule}”`}</Text>
      {input.quote ? <Text dimColor>{`From what you said: “${input.quote}”`}</Text> : null}
      <Text dimColor>{`${input.scope === 'project' ? '●' : '○'} This project only  ${input.projectFile}`}</Text>
      <Text dimColor>{`${input.scope === 'global' ? '●' : '○'} All your projects  ${input.globalFile}`}</Text>
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        <Button key="reflect:save:project" label="Save for this project" hotkey="1" autoFocus={input.scope === 'project' ? true : undefined}
                onPress={() => actions.save('project')} />
        <Button key="reflect:save:global" label="Save for all" hotkey="2" autoFocus={input.scope === 'global' ? true : undefined}
                onPress={() => actions.save('global')} />
        <Button key="reflect:reword" label="Reword" hotkey="3" onPress={actions.startReword} />
        <Button key="reflect:skip" label="Don't save" hotkey="4" onPress={actions.skip} />
        {more > 0 ? <Text dimColor>{`+${more} more · /sb-reflect`}</Text> : null}
      </Box>
    </Box>
  )
}
