// The see-through Client laid over a picture: it draws nothing, finds which part of the picture the
// pointer is over, and posts `{ hover }` when that changes and `{ press }` on a click (down and up on
// the same part). The hooks module redraws the picture's hover state and runs the part's action.
// Once a click has given it the keyboard, it posts each plain key as `{ key }` (Replay's p and n).
// This replaces blank Buttons under pictures, whose hover box the desktop app drew over them.
// A surface module: it imports nothing but types and draws with `surface.elements`.

import type { ClientModule } from 'claude-code'

/** One part that acts, in the region's cells: columns x..x+w, rows y..y+h. */
export type HitCell = { key: string; x: number; y: number; w: number; h: number }

/**
 * The region is exactly as big as what this draws, and `surface.rows` starts at 1, so the size comes
 * in as props (drawing surface.columns x surface.rows kept it one row tall).
 */
export type HitsProps = { columns: number; rows: number; hits: HitCell[] }

type Local = { hover: string; down: string; ref: { props: HitsProps } }

const Hits: ClientModule<HitsProps, Local> = (props, surface) => {
  const { Box } = surface.elements
  if (surface.state === undefined) {
    const ref = { props }
    surface.setState({ hover: '', down: '', ref })
    const at = (x: number, y: number) =>
      ref.props.hits.find(hit => x >= hit.x && x < hit.x + hit.w && y >= hit.y && y < hit.y + hit.h)?.key ?? ''
    surface.onKey(key => {
      if (!key.ctrl && !key.meta) surface.post({ key: key.key })
    })
    surface.onPointer(pointer => {
      const state = surface.state
      if (!state) return
      const hit = pointer.type === 'leave' ? '' : at(pointer.x, pointer.y)
      if (hit !== state.hover) surface.post({ hover: hit })
      if (pointer.type === 'down' && (pointer.button ?? 'left') === 'left') {
        surface.setState({ ...state, hover: hit, down: hit })
        return
      }
      if (pointer.type === 'up') {
        if (hit && hit === state.down) surface.post({ press: hit })
        surface.setState({ ...state, hover: hit, down: '' })
        return
      }
      if (hit !== state.hover || pointer.type === 'leave') {
        surface.setState({ ...state, hover: hit, down: pointer.type === 'leave' ? '' : state.down })
      }
    })
  } else {
    surface.state.ref.props = props // the latest parts, after a resize or a redraw
  }
  return <Box width={props.columns} height={props.rows} />
}

export default Hits
