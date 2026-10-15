// The design's tokens: Claude's warm palette, clay
// primary, teal in place of purple. Desktop pictures carry both themes as CSS variables and follow
// prefers-color-scheme, which the app sets from its own theme. The terminal uses Claude ThemeKeys,
// so it follows the person's theme by itself.

export type Palette = Record<TokenName, string>

export type TokenName =
  | 'bg' | 'surface' | 'card' | 'card2' | 'line' | 'line2' | 'ink' | 'muted' | 'faint' | 'prim' | 'onprim'
  | 'orange' | 'orangeSoft' | 'amber' | 'amberSoft' | 'teal' | 'tealSoft' | 'green' | 'greenSoft'
  | 'red' | 'redSoft' | 'blue' | 'blueSoft' | 'pink' | 'pinkSoft' | 'off' | 'frame' | 'focus'
  /** File badges, folders and row tints in the Files tree. */
  | 'js' | 'jsBg' | 'folder' | 'tealRow' | 'greenRow' | 'track'
  /** The desktop pane's own background, measured in v1: a picture painting it hides a Button's hover. */
  | 'pane'
  /** The gray the app draws behind the band above the prompt. */
  | 'band'
  /** Replay's diff: removed and added lines, their changed words, and the current step's row. */
  | 'addBg' | 'delBg' | 'addW' | 'delW' | 'pinkRow'
  /** Blast Radius: the red icon tile, the warning box, and the size bars. */
  | 'redSq' | 'redBox' | 'redLine' | 'bar' | 'bar2'
  /** Agents: the crab and its eyes. */
  | 'crab' | 'crabD'
  /** Reflect: the selected "where it goes" option. */
  | 'greenSel' | 'greenLine'
  /** Cache Tax: the inset well behind the two prices. */
  | 'well'
  /** Inbox: the Slack badge (rose). */
  | 'slack' | 'slackSoft'

export const DARK: Palette = {
  bg: '#262624', surface: '#2A2927', card: '#30302E', card2: '#3A3936',
  line: 'rgba(250,249,245,.08)', line2: 'rgba(250,249,245,.16)',
  ink: '#FAF9F5', muted: '#C2C0B6', faint: '#8F8D86', prim: '#D97757', onprim: '#FFFFFF',
  orange: '#D97757', orangeSoft: 'rgba(217,119,87,.16)', amber: '#D4A44E', amberSoft: 'rgba(212,164,78,.15)',
  teal: '#5FB3A8', tealSoft: 'rgba(95,179,168,.16)', green: '#8FB573', greenSoft: 'rgba(143,181,115,.15)',
  red: '#E3796B', redSoft: 'rgba(227,121,107,.14)', blue: '#7EA7D8', blueSoft: 'rgba(126,167,216,.15)',
  pink: '#D07A9C', pinkSoft: 'rgba(208,122,156,.16)', off: '#4A4945', frame: 'rgba(217,119,87,.55)', focus: '#D97757',
  js: '#D4A44E', jsBg: 'rgba(212,164,78,.14)', folder: '#7EA7D8', tealRow: 'rgba(95,179,168,.13)', greenRow: 'rgba(143,181,115,.12)', track: 'rgba(250,249,245,.08)',
  pane: '#262624', band: '#30302E',
  addBg: 'rgba(143,181,115,.16)', delBg: 'rgba(227,121,107,.16)', addW: 'rgba(143,181,115,.34)', delW: 'rgba(227,121,107,.38)',
  pinkRow: 'rgba(208,122,156,.14)',
  redSq: 'rgba(227,121,107,.16)', redBox: 'rgba(227,121,107,.1)', redLine: 'rgba(227,121,107,.42)', bar: '#E8E6DC', bar2: '#8F8D86',
  crab: '#D97757', crabD: '#2A1309',
  greenSel: 'rgba(143,181,115,.1)', greenLine: 'rgba(143,181,115,.45)', well: '#232220', slack: '#D88AA0', slackSoft: 'rgba(216,138,160,.15)',
}

export const LIGHT: Palette = {
  bg: '#FAF9F5', surface: '#F5F4ED', card: '#FFFFFF', card2: '#F0EEE6',
  line: 'rgba(20,20,19,.09)', line2: 'rgba(20,20,19,.17)',
  ink: '#141413', muted: '#5E5D59', faint: '#87867F', prim: '#C96442', onprim: '#FFFFFF',
  orange: '#C96442', orangeSoft: 'rgba(201,100,66,.11)', amber: '#9A6B14', amberSoft: 'rgba(201,150,45,.14)',
  teal: '#2B7A72', tealSoft: 'rgba(43,122,114,.1)', green: '#5A7A3E', greenSoft: 'rgba(90,122,62,.11)',
  red: '#B5463A', redSoft: 'rgba(181,70,58,.09)', blue: '#3F72A8', blueSoft: 'rgba(63,114,168,.1)',
  pink: '#A84E78', pinkSoft: 'rgba(168,78,120,.1)', off: '#D6D3C8', frame: 'rgba(201,100,66,.5)', focus: '#C96442',
  js: '#8A6414', jsBg: 'rgba(201,150,45,.14)', folder: '#3F72A8', tealRow: 'rgba(43,122,114,.08)', greenRow: 'rgba(90,122,62,.08)', track: 'rgba(20,20,19,.07)',
  pane: '#FFFFFF', band: '#F0F0EF',
  addBg: 'rgba(90,122,62,.1)', delBg: 'rgba(181,70,58,.08)', addW: 'rgba(90,122,62,.24)', delW: 'rgba(181,70,58,.2)',
  pinkRow: 'rgba(168,78,120,.08)',
  redSq: 'rgba(181,70,58,.1)', redBox: 'rgba(181,70,58,.06)', redLine: 'rgba(181,70,58,.35)', bar: '#3D3D3A', bar2: '#87867F',
  crab: '#C96442', crabD: '#3A1E12',
  greenSel: 'rgba(90,122,62,.07)', greenLine: 'rgba(90,122,62,.4)', well: '#EDEBE3', slack: '#A84E6E', slackSoft: 'rgba(168,78,110,.09)',
}

const vars = (palette: Palette) => Object.entries(palette).map(([name, value]) => `--${name}:${value}`).join(';')

/** Every picture starts with this: light tokens, dark ones under prefers-color-scheme. */
export const SVG_STYLE = `<style>svg{${vars(LIGHT)}}@media (prefers-color-scheme:dark){svg{${vars(DARK)}}}</style>`

/** A token as a picture uses it: follows the theme. */
export const c = (name: TokenName) => `var(--${name})`

/** Desktop grid, measured in v1: one column and one row in CSS pixels. */
export const CELL_PX = 7.85
export const ROW_PX = 19

export const SANS = `font-family="'Anthropic Sans', system-ui, -apple-system, 'Segoe UI', sans-serif"`
export const SERIF = `font-family="'Anthropic Serif', 'Tiempos Headline', Georgia, 'Times New Roman', serif"`
export const MONO = `font-family="'JetBrains Mono', 'SF Mono', ui-monospace, monospace"`

export const esc = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** About how wide a text draws, in px (a sans average; bold a little wider). */
export function textWidth(text: string, size: number, isBold = false): number {
  let units = 0
  for (const char of text) units += /[A-Z]/.test(char) ? 0.66 : /[ilj.,:;'|!]/.test(char) ? 0.3 : char === ' ' ? 0.3 : 0.54
  return units * size * (isBold ? 1.06 : 1)
}

/** Cut a text to fit `maxPx`, with an ellipsis, then escape it for SVG. */
export function fit(text: string, maxPx: number, size: number, isBold = false): string {
  if (textWidth(text, size, isBold) <= maxPx) return esc(text)
  let cut = text
  while (cut.length > 1 && textWidth(`${cut}…`, size, isBold) > maxPx) cut = cut.slice(0, -1)
  return esc(`${cut.trimEnd()}…`)
}

/** An SVG document `width` × `height` px with the theme tokens. */
export const svgOpen = (width: number, height: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${SVG_STYLE}`

/** 24×24 stroke paths from the design. */
export const ICON: Record<string, string> = {
  sliders: 'M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4',
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0',
  agents: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20c0-3 3-5 6-5s6 2 6 5M16 5a3 3 0 0 1 0 6M22 20c0-3-2-5-5-5',
  folder: 'M3 6h6l2 2h10v11H3z',
  play: 'M7 5l11 7-11 7z',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3',
  bookmark: 'M6 3h12v18l-6-4-6 4zM12 7v6M9 10h6',
  cube: 'M12 2l9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  close: 'M6 6l12 12M18 6L6 18',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  pencil: 'M4 20h4L19 9l-4-4L4 16z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5',
  branch: 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM12 8v5M12 16h.01',
  commit: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM2 12h6M16 12h6',
  database: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  check: 'M5 12l5 5 9-10',
  pause: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM10 9v6M14 9v6',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  send: 'M4 12l16-8-6 16-3-7z',
  shieldCheck: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  calendar: 'M4 6h16v14H4zM4 10h16M9 3v4M15 3v4',
  lines: 'M3 7h18M7 12h10M10 17h4',
  chat: 'M4 5h16v11H9l-5 4z',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6',
  arrow: 'M5 12h14M13 6l6 6-6 6',
}

/** A stroke icon at (x, y), `size` px. */
export const icon = (name: string, x: number, y: number, size: number, color: string) =>
  `<g transform="translate(${x},${y}) scale(${size / 24})"><path d="${ICON[name] ?? ''}" fill="none" ` +
  `style="stroke:${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></g>`

/** The dot-led colored all-caps label (`.eyebrow`). */
export const eyebrow = (text: string, x: number, baseline: number, color: string, size = 12.5) =>
  `<circle cx="${x + 3}" cy="${baseline - size * 0.36}" r="3" style="fill:${color}"/>` +
  `<text x="${x + 14}" y="${baseline}" ${SANS} font-size="${size}" font-weight="700" letter-spacing="${(size * 0.09).toFixed(2)}" ` +
  `style="fill:${color}">${esc(text.toUpperCase())}</text>`
