// The pixel crabs, one per look (16 × 14 cells): how an agent ran, from its model and effort.
// Detective (xhigh), racer (Haiku or low), chef (medium) and hard hat (high) are the design's (canvas,
// screen F1); astronaut (Fable) and pirate (Explore) are drawn in the same style.

import { c } from '../../ui/theme.ts'
import type { Look } from './model.ts'

const LEGS = 'M1 6h2v2H1zM13 6h2v2h-2zM4 10h1v2H4zM6 10h1v2H6zM9 10h1v2H9zM11 10h1v2h-1z'

/** Each tier's crab: colored parts first, then the body and the eyes in the theme's crab colors. */
const CRABS: Record<Look, { parts: [string, string][]; body: string; eyes: string }> = {
  // heavy: detective, brown hat with a feather.
  heavy: { parts: [['#7A4A2A', 'M4 2h8v3H4zM5 1h6v1H5z'], ['#9FB4D8', 'M12 0h1v2h-1z']], body: 'M3 5h10v5H3z', eyes: 'M5 6h1v1H5zM10 6h1v1h-1z' },
  // light: racer, in its car.
  light: { parts: [], body: 'M3 3h10v7H3z', eyes: 'M5 4h1v1H5zM10 4h1v1h-1z' },
  // medium: chef, with a pan.
  medium: { parts: [['#C2402F', 'M4 2h8v2H4zM3 3h1v1H3z'], ['#6FA8FF', 'M13 0h1v3h-1z'], ['#E9D7B0', 'M0 8h2v2H0z']], body: 'M3 4h10v6H3z', eyes: 'M5 6h1v1H5zM10 6h1v1h-1z' },
  // careful: hard hat.
  careful: { parts: [['#E8C14A', 'M4 1h8v3H4zM3 3h10v1H3z']], body: 'M3 4h10v6H3z', eyes: 'M5 6h1v1H5zM10 6h1v1h-1z' },
  // fable: astronaut, glass helmet and antenna.
  fable: { parts: [['#BFD7EA', 'M2 1h12v1H2zM1 2h1v7H1zM14 2h1v7h-1z'], ['#F2F2F0', 'M8 0h1v1H8z']], body: 'M3 3h10v7H3z', eyes: 'M5 5h1v1H5zM10 5h1v1h-1z' },
  // explore: pirate, hat and an eye patch.
  explore: { parts: [['#2A2A2A', 'M3 2h10v2H3zM5 1h6v1H5z'], ['#F2F2F0', 'M7 2h2v1H7z']], body: 'M3 4h10v6H3z', eyes: 'M10 6h1v1h-1z' },
}

/** A crab `size` px wide at (x, y); grey for a run that stopped or failed. */
export function crab(tier: Look, x: number, y: number, size: number, isGrey = false): string {
  const shape = CRABS[tier]
  const scale = size / 16
  const body = isGrey ? c('faint') : c('crab')
  const extra = tier === 'light' ? `<path fill="#C9CED6" d="M4 7h8v3H4z"/><path fill="#8A93A0" d="M5 8h6v1H5z"/>` : ''
  const patch = tier === 'explore' ? `<path fill="#2A2A2A" d="M4 5h3v1H4zM5 6h1v1H5z"/>` : ''
  return `<g transform="translate(${x},${y}) scale(${scale})" shape-rendering="crispEdges"${isGrey ? ' opacity=".55"' : ''}>` +
    shape.parts.map(([fill, d]) => `<path fill="${fill}" d="${d}"/>`).join('') +
    `<path style="fill:${body}" d="${shape.body}${LEGS}"/><path style="fill:${c('crabD')}" d="${shape.eyes}"/>${extra}${patch}</g>`
}
