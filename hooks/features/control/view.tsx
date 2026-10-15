// The Switchboard pane (screen 2): every feature with its command, what it's doing, and its switch.
// Pure: register.tsx hands in the elements, the data and the handlers.

import type { RenderElement } from 'claude-code'
import type { FeatureId, Tone } from '../../core/features.ts'
import { clickable, paneWidth, type Basic, type Hit, type Pictured, type Presses } from '../../ui/click.tsx'
import {
  FOOTER_H, LIST_PAD, ROW_H, TOGGLE_W, footerLayout, footerSvg, headerSvg, listSvg, sectionSvg, titleSvg,
  type ControlModel,
} from './pictures.ts'

export { controlModel, type ControlModel, type ControlRow } from './pictures.ts'

export type ControlHandlers = {
  toggle: (id: FeatureId) => void
  openInbox: () => void
  inboxSources: () => void
}

/**
 * The desktop pane: pictures with see-through Clients over the parts that act. `hover` is the key of
 * the part under the pointer; each part's action is put in `presses` under its key.
 */
export function controlDesktop(elements: Pictured, model: ControlModel, columns: number,
                               handlers: ControlHandlers, hover: string, presses: Presses): RenderElement {
  const { Box } = elements
  const width = paneWidth(columns)
  const listHeight = LIST_PAD * 2 + model.rows.length * ROW_H
  const toggleX = width - 20 - TOGGLE_W
  const footer = footerLayout()
  const hits: Hit[] = model.rows.flatMap((row, index) => row.isAvailable ? [{
    // The switch itself, a little padded: the pointer reports whole cells (about 8 x 19 px).
    key: `toggle:${row.id}`, leftPx: toggleX - 4, widthPx: TOGGLE_W + 8,
    topPx: LIST_PAD + index * ROW_H + 15, heightPx: 32, onPress: () => handlers.toggle(row.id),
  }] : [])
  return (
    <Box flexDirection="column" gap={1}>
      {clickable(elements, 'title', titleSvg(width), 'Switchboard', width, 40, [], presses)}
      {clickable(elements, 'now', headerSvg(width, model), `Right now: ${model.headline}. ${model.sub}`, width, 98, [], presses)}
      {clickable(elements, 'section', sectionSvg(width, 'FEATURES'), 'Features', width, 26, [], presses)}
      {clickable(elements, 'features', listSvg(width, model.rows, hover),
        model.rows.map(row => `${row.name} ${row.isOn ? 'on' : 'off'}, ${row.status}`).join('; '),
        width, listHeight, hits, presses)}
      {clickable(elements, 'footer', footerSvg(width, hover), 'Open Inbox. Inbox sources. Changes apply right away.', width, FOOTER_H, [
        { key: 'open-inbox', leftPx: footer.openInbox.x, widthPx: footer.openInbox.w, topPx: 4, heightPx: 42, onPress: handlers.openInbox },
        { key: 'inbox-sources', leftPx: footer.sources.x, widthPx: footer.sources.w, topPx: 4, heightPx: 42, onPress: handlers.inboxSources },
      ], presses)}
    </Box>
  )
}

// ---- terminal and other text surfaces ------------------------------------------------------------

const TONE_KEY: Record<Tone, string> = {
  amber: 'warning', orange: 'claude', teal: 'suggestion', pink: 'merged', red: 'error', green: 'success',
  blue: 'ide', faint: 'inactive',
}

export function controlText(elements: Basic, model: ControlModel, handlers: ControlHandlers,
                            hasKeys: boolean): RenderElement {
  const { Box, Button, Text } = elements
  return (
    <Box flexDirection="column">
      <Text bold>Switchboard</Text>
      <Box flexDirection="row" gap={1}>
        <Text color="claude" bold>● RIGHT NOW</Text>
        <Text bold>{model.headline}</Text>
      </Box>
      <Text dimColor>{model.sub}</Text>
      <Text> </Text>
      <Text dimColor bold>FEATURES</Text>
      {model.rows.map((row, index) => (
        <Box key={`row:${row.id}`} flexDirection="row" gap={1}>
          {row.isAvailable
            ? <Button key={`toggle:${row.id}`} label={row.isOn ? 'On ' : 'Off'} variant={row.isOn ? 'primary' : 'secondary'}
                      hotkey={hasKeys ? String(index + 1) : undefined} onPress={() => handlers.toggle(row.id)} />
            : <Text dimColor>[ -- ]</Text>}
          <Text color={TONE_KEY[row.tone]}>●</Text>
          <Text bold={row.isAvailable} dimColor={!row.isAvailable}>{row.name}</Text>
          <Text color="claude">{row.command}</Text>
          <Text dimColor wrap="truncate-end">{row.status}</Text>
        </Box>
      ))}
      <Text> </Text>
      <Box flexDirection="row" gap={1}>
        <Button key="open-inbox" label="Open Inbox" variant="primary" onPress={handlers.openInbox} />
        <Button key="inbox-sources" label="Inbox sources" onPress={handlers.inboxSources} />
        <Text dimColor>Changes apply right away</Text>
      </Box>
    </Box>
  )
}
