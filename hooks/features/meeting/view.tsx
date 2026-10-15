// The meeting card above the prompt (screen 6): pictures with see-through Clients on the desktop (the
// full card when it fits the band, else the compact one), text with real Buttons in the terminal. Pure.

import type { RenderElement } from 'claude-code'
import { clickable, paneWidth, withAction, type Basic, type Pictured, type Presses } from '../../ui/click.tsx'
import { ROW_PX } from '../../ui/theme.ts'
import { joinable, type Meeting } from './model.ts'
import { buttonsSvg, cardSvg, clockText, compactSvg, detailText, whenText } from './pictures.ts'

export type MeetingActions = {
  join: (id: string) => void
  later: (minutes: number) => void
  dismiss: () => void
}

function run(actions: MeetingActions, key: string): void {
  if (key.startsWith('meeting:join:')) actions.join(key.slice('meeting:join:'.length))
  else if (key.startsWith('meeting:later:')) actions.later(Number(key.slice('meeting:later:'.length)) || 1)
  else if (key === 'meeting:dismiss') actions.dismiss()
}

export function meetingCard(elements: Basic | Pictured, isDesktop: boolean, meetings: readonly Meeting[], now: number, leadMs: number,
                            columns: number, maxRows: number, actions: MeetingActions, hover: string, presses: Presses): RenderElement {
  const { Box } = elements
  const first = meetings[0]!
  const act = (key: string) => run(actions, key)
  const alt = `Meeting ${whenText(first, now)}: ${meetings.map(one => one.title).join(', ')}. ${detailText(first)}`
  if (isDesktop && 'Svg' in elements) {
    const width = paneWidth(columns)
    const card = cardSvg(width, meetings, now, leadMs)
    const buttons = buttonsSvg(width, meetings, hover)
    if (card.height + ROW_PX + buttons.height > maxRows * ROW_PX) {
      const compact = compactSvg(width, meetings, now, leadMs, hover)
      return (
        <Box key="meeting" flexDirection="column">
          {clickable(elements, 'meeting-card', compact.svg, `${alt} Join now, Remind me in 1 min, In 3 min, Not going`, width, compact.height,
            withAction(compact.parts, act), presses)}
        </Box>
      )
    }
    return (
      <Box key="meeting" flexDirection="column" gap={1}>
        {clickable(elements, 'meeting-card', card.svg, alt, width, card.height, [], presses)}
        {clickable(elements, 'meeting-buttons', buttons.svg, 'Join now, Remind me in 1 min, In 3 min, Not going', width, buttons.height,
          withAction(buttons.parts, act), presses)}
      </Box>
    )
  }
  const { Button, Text } = elements
  return (
    <Box key="meeting" flexDirection="column" borderStyle="round" borderColor="error" paddingX={1}>
      <Text color="error" bold>{`● MEETING · ${whenText(first, now).toUpperCase()} · ${clockText(first, now)}`}</Text>
      <Text bold>{meetings.map(one => one.title).join(' · ')}</Text>
      <Text dimColor wrap="truncate-end">{`${detailText(first)}${first.attendees.length ? ` · ${first.attendees.slice(0, 4).join(', ')}` : ''}`}</Text>
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {meetings.filter(one => joinable(one.joinUrl)).map((one, index) => (
          <Button key={`meeting:join:${one.id}`} label={meetings.length > 1 ? `Join ${one.title}` : 'Join now'} hotkey={index === 0 ? '1' : undefined}
                  autoFocus={index === 0 ? true : undefined} onPress={() => actions.join(one.id)} />
        ))}
        <Button key="meeting:later:1" label="Remind me in 1 min" hotkey="2" onPress={() => actions.later(1)} />
        <Button key="meeting:later:3" label="In 3 min" hotkey="3" onPress={() => actions.later(3)} />
        <Button key="meeting:dismiss" label="Not going" hotkey="4" onPress={actions.dismiss} />
      </Box>
    </Box>
  )
}
