// The Files pane (screens F2 and F3): pictures with see-through Clients on the desktop, text with
// real Buttons in the terminal. Pure: register.tsx hands in the elements, the state and the actions.

import type { ElementConstructor, InputProps, RenderElement } from 'claude-code'
import { clickable, paneWidth, withAction, type Basic, type Pictured, type Presses } from '../../ui/click.tsx'
import { buttonRow, sectionSvg, titleSvg } from '../../ui/kit.ts'
import { basename } from './paths.ts'
import { branchLineOf, cardOf, footerOf, projectName, shortSize, shortTime, touchedRows, treeRows, type FilesState } from './model.ts'
import { footerSvg, matchesSvg, noteSvg, statusSvg, touchedSvg, treeChunks } from './pictures.ts'

/** Both surfaces draw a text field (the app's own): "Find a file". */
type WithInput = { Input: ElementConstructor<InputProps> }

export type FilesActions = {
  refresh: () => void
  collapseAll: () => void
  upFolder: () => void
  backToProject: () => void
  toggleHidden: () => void
  toggleSizes: () => void
  /** "Find a file": every change of the text. */
  search: (query: string) => void
  /** A match, or a "Claude touched" row: open its folders and scroll to it. */
  openMatch: (path: string) => void
  /** A folder row: open or close it. */
  toggleFolder: (path: string) => void
  /** A "Claude touched" row: show the file in the tree. */
  reveal: (path: string) => void
}

function tools(state: FilesState, actions: FilesActions, isAway: boolean) {
  const buttons = [
    { key: 'tool:collapse', label: 'Collapse all' },
    { key: 'tool:up', label: 'Up a folder' },
    ...(isAway ? [{ key: 'tool:home', label: 'Back to project' }] : []),
    { key: 'tool:sizes', label: state.showSizes ? 'Hide sizes' : 'Show sizes' },
    { key: 'tool:hidden', label: state.showHidden ? 'Hide hidden' : 'Show hidden' },
  ]
  const run: Record<string, () => void> = {
    'tool:refresh': actions.refresh, 'tool:collapse': actions.collapseAll, 'tool:up': actions.upFolder,
    'tool:home': actions.backToProject, 'tool:hidden': actions.toggleHidden, 'tool:sizes': actions.toggleSizes,
  }
  return { buttons, run }
}

/**
 * The desktop pane, top to bottom; the pane itself scrolls (natively). The tree is drawn in pictures
 * of 8 rows, each keyed, so `$.ui.scroll` can bring the one holding an edited file into view.
 */
export function filesDesktop(elements: Pictured & WithInput, state: FilesState, columns: number, actions: FilesActions,
                             hover: string, presses: Presses, now: number, isAway: boolean): RenderElement {
  const { Box, Input } = elements
  const width = paneWidth(columns)
  const status = statusSvg(width, state)
  const toolbar = tools(state, actions, isAway)
  const row = buttonRow(width, toolbar.buttons, hover, 24) // a little tighter, so four fit on one line
  const touched = touchedRows(state)
  const touchedPicture = touched.length ? touchedSvg(width, touched, hover) : null
  const tree = treeChunks(width, state, hover, now)
  const card = cardOf(state)
  const name = projectName(state)
  const isSearching = !!state.search.query.trim()
  const matches = isSearching ? matchesSvg(width, state, hover) : null
  const footer = footerSvg(width, state)
  const folders = new Set(treeRows(state).rows.filter(one => one.isDir).map(one => `row:${one.path}`))
  const onRow = (key: string) => actions.toggleFolder(key.slice('row:'.length))
  return (
    <Box flexDirection="column" gap={1}>
      {clickable(elements, 'files-title', titleSvg(width, `Files: ${name}`), `Files: ${name}`, width, 40, [], presses)}
      {clickable(elements, 'files-status', status.svg,
        [card ? `${card.eyebrow}: ${card.title}. ${card.sub}` : '', branchLineOf(state)?.note ?? 'Not a git folder'].filter(Boolean).join(' '),
        width, status.height, [], presses)}
      {clickable(elements, 'files-tools', row.svg, toolbar.buttons.map(button => button.label).join(', '), width, row.height,
        withAction(row.parts, key => toolbar.run[key]?.()), presses)}
      <Input key="files-search" placeholder="Find a file" value={state.search.query} submitLabel="open"
             onInput={value => actions.search(value)}
             onSubmit={() => (state.search.matches[0] ? actions.openMatch(state.search.matches[0]) : undefined)} />
      {matches
        ? clickable(elements, 'files-matches', matches.svg,
          `Matches: ${state.search.matches.join(', ')}`, width, matches.height,
          withAction(matches.parts, key => (key === 'search:clear' ? actions.search('') : actions.openMatch(key.slice('match:'.length)))), presses)
        : null}
      {touchedPicture
        ? clickable(elements, 'files-touched', touchedPicture.svg,
          `Claude touched: ${touched.map(one => `${one.path} ${one.pill}`).join(', ')}`, width, touchedPicture.height,
          withAction(touchedPicture.parts, key => actions.reveal(key.slice('touched:'.length))), presses)
        : null}
      {clickable(elements, 'files-section', sectionSvg(width, 'All files', name), `All files in ${name}`, width, 26, [], presses)}
      {state.error
        ? clickable(elements, 'files-error', noteSvg(width, state.error), state.error, width, 40, [], presses)
        : tree.chunks.length === 0
          ? clickable(elements, 'files-empty', noteSvg(width, state.nodes[''] ? 'This folder is empty.' : 'Loading the folder…'),
            'Loading', width, 40, [], presses)
          : tree.chunks.map(chunk => clickable(elements, chunk.key, chunk.svg, chunk.alt, width, chunk.height,
            withAction(chunk.parts.filter(part => folders.has(part.key)), onRow), presses))}
      {tree.more ? clickable(elements, 'files-more', noteSvg(width, `${tree.more} more not shown. Close a folder to see them.`),
        'More files not shown', width, 40, [], presses) : null}
      {footer ? clickable(elements, 'files-footer', footer.svg, footerOf(state).map(line => `${line.text} ${line.code}`.trim()).join(', '),
        width, footer.height, [], presses) : null}
    </Box>
  )
}

// ---- terminal and other text surfaces --------------------------------------------------------------

const TONE_KEY: Record<string, string> = { teal: 'suggestion', orange: 'claude', green: 'success', amber: 'warning', muted: 'inactive' }

export function filesText(elements: Basic & WithInput, state: FilesState, actions: FilesActions, now: number, isAway: boolean): RenderElement {
  const { Box, Button, Input, Text } = elements
  const card = cardOf(state)
  const line = branchLineOf(state)
  const touched = touchedRows(state)
  const { rows } = treeRows(state)
  const toolbar = tools(state, actions, isAway)
  const shown = rows.slice(0, 150)
  return (
    <Box flexDirection="column">
      <Text bold>{`Files: ${projectName(state)}`}</Text>
      {card ? (
        <Box flexDirection="column">
          <Text color={TONE_KEY[card.tone]} bold>{`● ${card.eyebrow.toUpperCase()}  ${card.title}`}</Text>
          {card.sub ? <Text dimColor>{card.sub}</Text> : null}
        </Box>
      ) : null}
      <Box flexDirection="row" gap={1}>
        <Text bold>{line ? line.name : 'Not a git folder'}</Text>
        {line && (line.add || line.del) ? <Text color="success">{`+${line.add}`}</Text> : null}
        {line && (line.add || line.del) ? <Text color="error">{`−${line.del}`}</Text> : null}
        {line ? <Text color={TONE_KEY[line.noteTone]}>{line.note}</Text> : null}
      </Box>
      <Box flexDirection="row" gap={1}>
        {toolbar.buttons.map(button => <Button key={button.key} label={button.label} plain onPress={() => toolbar.run[button.key]?.()} />)}
      </Box>
      <Input key="files-search" label="Find" placeholder="a file" value={state.search.query} submitLabel="open"
             onInput={value => actions.search(value)}
             onSubmit={() => (state.search.matches[0] ? actions.openMatch(state.search.matches[0]) : undefined)} />
      {state.search.query.trim() ? (
        <Box flexDirection="column">
          <Text dimColor bold>{state.search.isLoading ? 'LOOKING…' : `${state.search.total} ${state.search.total === 1 ? 'MATCH' : 'MATCHES'}`}</Text>
          {state.search.matches.slice(0, 20).map(path => (
            <Button key={`m:${path}`} plain label={path} onPress={() => actions.openMatch(path)} />
          ))}
        </Box>
      ) : null}
      {touched.length ? <Text dimColor bold>{`CLAUDE TOUCHED · ${touched.length}`}</Text> : null}
      {touched.slice(0, 12).map(one => (
        <Box key={`t:${one.path}`} flexDirection="row" gap={1}>
          <Text bold>{one.isOutside ? one.path : one.name}</Text>
          {one.detail ? <Text dimColor>{one.detail}</Text> : null}
          {one.add || one.del ? <Text color="success">{`+${one.add ?? 0}`}</Text> : null}
          {one.add || one.del ? <Text color="error">{`−${one.del ?? 0}`}</Text> : null}
          <Text color={TONE_KEY[one.tone]}>{one.pill}</Text>
        </Box>
      ))}
      <Text dimColor bold>{`ALL FILES · ${projectName(state)}`}</Text>
      {state.error ? <Text color="error">{state.error}</Text> : null}
      {shown.map(row => row.isDir ? (
        <Button key={`row:${row.path}`} plain label={`${'  '.repeat(row.depth)}${row.isOpen ? '▾' : '▸'} ${row.name}/`}
                onPress={() => actions.toggleFolder(row.path)} />
      ) : (
        <Box key={`row:${row.path}`} flexDirection="row" gap={1}>
          <Text color={row.tone ? TONE_KEY[row.tone] : undefined} bold={!!row.mark && row.mark !== 'changed'}>
            {`${'  '.repeat(row.depth)}  ${basename(row.path)}`}
          </Text>
          <Text dimColor>{row.mark && row.mark !== 'changed' ? row.mark : state.showSizes ? shortSize(row.size) : shortTime(row.mtimeMs, now)}</Text>
        </Box>
      ))}
      {rows.length > shown.length ? <Text dimColor>{`${rows.length - shown.length} more not shown`}</Text> : null}
      {footerOf(state).map(line => <Text key={`f:${line.text}`} color="success">{`● ${line.text} ${line.code}`.trimEnd()}</Text>)}
    </Box>
  )
}
