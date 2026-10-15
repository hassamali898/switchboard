// The one way to make part of a picture clickable on the desktop (decided 2026-10-11, P0-2).
//
// A picture is drawn exactly as the design shows it, and a see-through Client (`hits.tsx`) is laid
// over it. The Client reports which part the pointer is over and which part was clicked; the hooks
// module redraws the picture's hover state and runs the part's action. No app Button sits under the
// picture, so the app's own hover box never shows.
//
// Every part's action goes into `presses` under its key while drawing; register.tsx runs it when the
// Client posts `{ press: key }`. Hover comes back as the `hover` state value and is drawn by the
// picture itself.

import type {
  BoxProps, ButtonProps, ClientProps, ElementConstructor, RenderElement, SvgProps, TextProps,
} from 'claude-code'
import type { HitCell } from './hits.tsx'
import { CELL_PX, ROW_PX } from './theme.ts'

/** The elements every surface has. */
export type Basic = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
}

/** The desktop adds pictures and Client regions. */
export type Pictured = Basic & { Svg: ElementConstructor<SvgProps>; Client: ElementConstructor<ClientProps> }

/** One part of a picture that acts: where it is (px from the picture's top left) and what it does. */
export type Hit = {
  key: string
  leftPx: number
  widthPx: number
  topPx: number
  heightPx: number
  onPress: () => void
}

/** Actions by part key, filled while drawing. */
export type Presses = Map<string, () => void>

/** A picture's parts, each running `act` with its key when pressed. */
export const withAction = (parts: readonly Omit<Hit, 'onPress'>[], act: (key: string) => void): Hit[] =>
  parts.map(part => ({ ...part, onPress: () => act(part.key) }))

/** A pane's picture width in px for its width in columns (never under 320). */
export const paneWidth = (columns: number): number => Math.max(320, Math.floor(columns * CELL_PX) - 4)

/** A part's cells: every cell the part's pixels touch. */
export function toCells(hit: Hit): HitCell {
  const x = Math.floor(hit.leftPx / CELL_PX)
  const y = Math.floor(hit.topPx / ROW_PX)
  return {
    key: hit.key, x, y,
    w: Math.max(1, Math.ceil((hit.leftPx + hit.widthPx) / CELL_PX) - x),
    h: Math.max(1, Math.ceil((hit.topPx + hit.heightPx) / ROW_PX) - y),
  }
}

/** A picture with the parts of it that act: the picture, then the see-through Client over it. */
export function clickable(elements: Pictured, key: string, source: string, alt: string,
                          widthPx: number, heightPx: number, hits: readonly Hit[], presses: Presses): RenderElement {
  const { Box, Client, Svg } = elements
  const picture = <Svg source={source} alt={alt} width={widthPx} height={heightPx} />
  if (hits.length === 0) return <Box key={key}>{picture}</Box>
  for (const hit of hits) presses.set(hit.key, hit.onPress)
  const columns = Math.max(1, Math.ceil(widthPx / CELL_PX))
  const rows = Math.max(1, Math.round(heightPx / ROW_PX))
  return (
    <Box key={key} alignSelf="flex-start">
      {picture}
      <Box position="absolute" top={0} left={0} width={columns} height={rows}>
        <Client key={`${key}:hits`} module="./hits.tsx" width={columns} height={rows}
                props={{ columns, rows, hits: hits.map(toCells) }} />
      </Box>
    </Box>
  )
}
