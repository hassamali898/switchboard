// Cache Tax's card above the prompt (screen F7): pictures with see-through Clients on the desktop (the
// full card when it fits the band, else the compact one), text with real Buttons in the terminal
// (1 pays and sends, 2 starts fresh, 3 shows the cache status). Pure: register.tsx hands in what it needs.

import type { RenderElement } from 'claude-code'
import { clickable, paneWidth, withAction, type Basic, type Pictured, type Presses } from '../../ui/click.tsx'
import { ROW_PX } from '../../ui/theme.ts'
import { fmtDuration, fmtRate, fmtUsd, type CacheHeld } from './model.ts'
import { buttonsSvg, cardSvg, compactSvg } from './pictures.ts'

export type CacheActions = {
  pay: () => void
  fresh: () => void
  status: () => void
}

function run(actions: CacheActions, key: string): void {
  if (key === 'cache:pay') actions.pay()
  else if (key === 'cache:fresh') actions.fresh()
  else if (key === 'cache:status') actions.status()
}

const summary = (held: CacheHeld) =>
  `Your message is on hold: the prompt cache went cold ${fmtDuration(held.coldForMs)} ago. Sending it now costs about ` +
  `${fmtUsd(held.coldUsd)}; a warm turn ${fmtUsd(held.warmUsd)}.`

export function cacheCard(elements: Basic | Pictured, isDesktop: boolean, held: CacheHeld, columns: number, maxRows: number,
                          actions: CacheActions, hover: string, presses: Presses): RenderElement {
  const { Box } = elements
  const act = (key: string) => run(actions, key)
  if (isDesktop && 'Svg' in elements) {
    const width = paneWidth(columns)
    const card = cardSvg(width, held)
    const buttons = buttonsSvg(width, hover)
    if (card.height + ROW_PX + buttons.height > maxRows * ROW_PX) {
      const compact = compactSvg(width, held, hover)
      return (
        <Box key="cache" flexDirection="column">
          {clickable(elements, 'cache-card', compact.svg, `${summary(held)} Pay and send, Start fresh, Show cache status`,
            width, compact.height, withAction(compact.parts, act), presses)}
        </Box>
      )
    }
    return (
      <Box key="cache" flexDirection="column" gap={1}>
        {clickable(elements, 'cache-card', card.svg, summary(held), width, card.height, [], presses)}
        {clickable(elements, 'cache-buttons', buttons.svg, 'Pay and send, Start fresh, Show cache status', width, buttons.height,
          withAction(buttons.parts, act), presses)}
      </Box>
    )
  }
  const { Button, Text } = elements
  return (
    <Box key="cache" flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1}>
      <Box flexDirection="row" gap={1}>
        <Text color="warning" bold>● CACHE TAX</Text>
        <Text bold>Your message is on hold</Text>
        <Text dimColor>{`· cold ${fmtDuration(held.coldForMs)}`}</Text>
      </Box>
      <Box flexDirection="row" gap={2} flexWrap="wrap">
        <Text>{'Send it now '}<Text color="warning" bold>{fmtUsd(held.coldUsd)}</Text></Text>
        <Text>{'A warm turn '}<Text color="success" bold>{fmtUsd(held.warmUsd)}</Text></Text>
        <Text dimColor>{`re-writes up to ${held.tokens.toLocaleString('en-US')} tokens${held.writeRate !== null ? ` at ${fmtRate(held.writeRate)}` : ''}`}</Text>
      </Box>
      <Text dimColor wrap="truncate-end">{`On hold: “${held.text.replace(/\s+/g, ' ').trim()}”`}</Text>
      <Text dimColor>Pay once to send it. /sb-cache warm keeps it warm after, if you want.</Text>
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        <Button key="cache:pay" label="Pay and send" hotkey="1" autoFocus onPress={actions.pay} />
        <Button key="cache:fresh" label="Start fresh" hotkey="2" onPress={actions.fresh} />
        <Button key="cache:status" label="Show cache status" hotkey="3" onPress={actions.status} />
      </Box>
    </Box>
  )
}
