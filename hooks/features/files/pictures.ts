// The Files pane's desktop pictures (screens F2 and F3). Plain TypeScript, no JSX and no engine, so
// the same pictures render in tests and in scripts/preview.ts.

import { MONO, SANS, SERIF, c, esc, eyebrow, fit, icon, textWidth, type TokenName } from '../../ui/theme.ts'
import { badge, cardRect, panel, pill, type Part, type PillTone } from '../../ui/kit.ts'
import {
  branchLineOf, cardOf, footerOf, shortSize, shortTime, treeRows, type FilesState, type Tone, type TouchedRow, type TreeRow,
} from './model.ts'
import { basename, dirname } from './paths.ts'

const TONE: Record<Tone, { fg: TokenName; soft: TokenName }> = {
  teal: { fg: 'teal', soft: 'tealSoft' }, orange: { fg: 'orange', soft: 'orangeSoft' }, green: { fg: 'green', soft: 'greenSoft' },
  amber: { fg: 'amber', soft: 'amberSoft' }, muted: { fg: 'muted', soft: 'card2' },
}

/** The status card: RIGHT NOW / DONE (when there is one), the branch row and the legend. */
export function statusSvg(width: number, state: FilesState): { svg: string; height: number } {
  const card = cardOf(state)
  const line = branchLineOf(state)
  let body = ''
  let y = 0
  if (card) {
    const tone = TONE[card.tone]
    body += `<rect x="20" y="20" width="54" height="54" rx="14" style="fill:${c(tone.soft)}"/>` + icon(card.icon, 35, 35, 24, c(tone.fg)) +
      eyebrow(card.eyebrow, 92, 36, c(tone.fg)) +
      `<text x="92" y="62" ${SERIF} font-size="20" font-weight="500" style="fill:${c('ink')}">${fit(card.title, width - 112, 20)}</text>` +
      (card.sub ? `<text x="92" y="84" ${SANS} font-size="15" style="fill:${c('muted')}">${fit(card.sub, width - 112, 15)}</text>` : '') +
      `<line x1="92" x2="${width - 20}" y1="100.5" y2="100.5" style="stroke:${c('line')}"/>`
    y = 100
  } else y = 6

  // The branch row.
  const rowMid = y + 22
  body += icon('branch', 20, rowMid - 9, 18, c('muted'))
  if (line) {
    body += `<text x="48" y="${rowMid + 6}" ${SANS} font-size="17" font-weight="700" style="fill:${c('ink')}">${fit(line.name, width / 2 - 60, 17, true)}</text>`
    let x = width - 20
    const right = (text: string, color: string, isBold = false) => {
      body += `<text x="${x}" y="${rowMid + 6}" text-anchor="end" ${SANS} font-size="15" font-weight="${isBold ? 600 : 400}" style="fill:${color}">${esc(text)}</text>`
      x -= textWidth(text, 15, isBold) + 8
    }
    right(line.note, c(TONE[line.noteTone].fg), line.noteTone !== 'muted')
    if (line.add || line.del) {
      right('·', c('muted'))
      right(`−${line.del}`, c('red'), true)
      right(`+${line.add}`, c('green'), true)
    }
  } else {
    body += `<text x="48" y="${rowMid + 6}" ${SANS} font-size="16" style="fill:${c('muted')}">Not a git folder</text>`
  }
  y += 44

  // The legend, except on the DONE card (the design leaves it out there).
  if (card?.eyebrow !== 'Done') {
    const items: [string, TokenName][] = [['Claude read', 'teal'], ['Claude edited', 'orange']]
    if (line) items.push(['Not committed', 'amber'])
    let x = 20
    for (const [label, color] of items) {
      body += `<circle cx="${x + 6}" cy="${y + 13}" r="6" style="fill:${c(color)}"/>` +
        `<text x="${x + 20}" y="${y + 18}" ${SANS} font-size="15" style="fill:${c('muted')}">${esc(label)}</text>`
      x += 20 + textWidth(label, 15) + 22
    }
    y += 32
  }
  const height = y + 14
  return { svg: panel(width, height, cardRect(width, height) + body), height }
}

const TOUCHED_ROW = 38

/** "Claude touched": each file with its badge, folder, line counts and pill. Rows reveal the file. */
export function touchedSvg(width: number, rows: readonly TouchedRow[], hover: string): { svg: string; body: string; height: number; parts: Part[] } {
  const parts: Part[] = []
  let body = `<text x="20" y="30" ${SANS} font-size="12.5" font-weight="700" letter-spacing="1.1" style="fill:${c('muted')}">CLAUDE TOUCHED</text>` +
    `<text x="${width - 20}" y="30" text-anchor="end" ${SANS} font-size="12.5" font-weight="700" letter-spacing="1.1" style="fill:${c('muted')}">` +
    `${rows.length} ${rows.length === 1 ? 'FILE' : 'FILES'}</text>`
  rows.forEach((row, index) => {
    const top = 42 + index * TOUCHED_ROW
    const mid = top + TOUCHED_ROW / 2
    const key = `touched:${row.path}`
    parts.push({ key, leftPx: 8, widthPx: width - 16, topPx: top, heightPx: TOUCHED_ROW })
    if (hover === key) body += `<rect x="8" y="${top + 2}" width="${width - 16}" height="${TOUCHED_ROW - 4}" rx="10" style="fill:${c('card2')}"/>`
    const mark = badge(40, mid, row.name)
    const pillText = row.pill
    const pillW = textWidth(pillText, 13.5, true) + 22
    let rightEdge = width - 20 - pillW - 10
    let counts = ''
    if (row.add !== undefined && (row.add || row.del)) {
      const del = `−${row.del ?? 0}`
      const add = `+${row.add}`
      counts = `<text x="${rightEdge}" y="${mid + 5}" text-anchor="end" ${SANS} font-size="14.5" style="fill:${c('red')}">${del}</text>` +
        `<text x="${rightEdge - textWidth(del, 14.5) - 6}" y="${mid + 5}" text-anchor="end" ${SANS} font-size="14.5" style="fill:${c('green')}">${add}</text>`
      rightEdge -= textWidth(del, 14.5) + textWidth(add, 14.5) + 16
    }
    const nameX = 40 + mark.width + 10
    const name = row.isOutside ? row.path : row.name
    const nameW = Math.min(textWidth(name, 16, true), rightEdge - nameX - 40)
    body += mark.svg +
      `<text x="${nameX}" y="${mid + 5.5}" ${SANS} font-size="16" font-weight="700" style="fill:${c('ink')}">${fit(name, rightEdge - nameX - 10, 16, true)}</text>` +
      (row.detail && nameX + nameW + 60 < rightEdge
        ? `<text x="${nameX + nameW + 10}" y="${mid + 5}" ${SANS} font-size="14.5" style="fill:${c('muted')}">${fit(row.detail, rightEdge - nameX - nameW - 20, 14.5)}</text>` : '') +
      counts + pill(width - 20, mid, pillText, row.tone as PillTone)
  })
  const height = 42 + rows.length * TOUCHED_ROW + 12
  return { svg: panel(width, height, cardRect(width, height) + body), body: cardRect(width, height) + body, height, parts }
}

export const TREE_ROW = 38
const INDENT = 22
/**
 * Rows per tree picture: small enough to scroll the pane to the one holding a file, big enough that the
 * style each picture carries isn't repeated too often. The desktop draws at most DESKTOP_ROWS rows, which
 * keeps the pane's tree near 100,000 characters (each row is ~640 of SVG).
 */
const CHUNK = 20
const DESKTOP_ROWS = 120

const caret = (x: number, mid: number, isOpen: boolean) => isOpen
  ? `<path d="M${x} ${mid - 2.5}l4.5 5 4.5-5z" style="fill:${c('muted')}"/>`
  : `<path d="M${x + 2} ${mid - 4.5}l5 4.5-5 4.5z" style="fill:${c('muted')}"/>`

const ROW_TINT: Partial<Record<NonNullable<TreeRow['mark']>, TokenName>> = { reading: 'tealRow', committed: 'greenRow', edited: 'orangeSoft' }

/** One tree row's SVG at `top`. */
function treeRow(width: number, row: TreeRow, top: number, isHover: boolean, now: number, showSizes: boolean): string {
  const mid = top + TREE_ROW / 2
  const x = 12 + row.depth * INDENT
  const tint = row.mark ? ROW_TINT[row.mark] : undefined
  let svg = tint || isHover
    ? `<rect x="2" y="${top + 1.5}" width="${width - 4}" height="${TREE_ROW - 3}" rx="10" style="fill:${c(tint ?? 'card2')}"/>` : ''
  const color = row.tone ? c(TONE[row.tone].fg) : c('ink')
  if (row.isDir) {
    const size = showSizes ? (row.size < 0 ? '…' : shortSize(row.size)) : ''
    const sizeW = size ? textWidth(size, 14.5) + 16 : 0
    svg += caret(x, mid, row.isOpen) + icon('folder', x + 16, mid - 9, 18, row.tone ? color : c('folder')) +
      `<text x="${x + 42}" y="${mid + 5.5}" ${SANS} font-size="16" style="fill:${color}">${fit(row.name, width - x - 60 - sizeW, 16)}</text>` +
      (size ? `<text x="${width - 12}" y="${mid + 5}" text-anchor="end" ${SANS} font-size="14.5" style="fill:${c('muted')}">${esc(size)}</text>` : '')
    return svg
  }
  const mark = badge(x + 14, mid, row.name)
  const nameX = x + 14 + mark.width + 10
  const isMarked = row.mark === 'reading' || row.mark === 'committed' || row.mark === 'edited'
  const pillText = row.mark === 'reading' ? 'reading' : row.mark === 'committed' ? 'committed' : row.mark === 'edited' ? 'edited' : ''
  const time = pillText ? '' : showSizes ? shortSize(row.size) : shortTime(row.mtimeMs, now)
  const rightW = pillText ? textWidth(pillText, 13, true) + 30 : time ? textWidth(time, 15) + 16 : 0
  svg += mark.svg +
    `<text x="${nameX}" y="${mid + 5.5}" ${SANS} font-size="16" font-weight="${isMarked ? 700 : 400}" style="fill:${color}">` +
    `${fit(row.name, width - nameX - rightW - 14, 16, isMarked)}</text>`
  if (pillText) svg += pill(width - 12, mid, pillText, (row.tone ?? 'muted') as PillTone, 13)
  else if (time) svg += `<text x="${width - 12}" y="${mid + 5}" text-anchor="end" ${SANS} font-size="14.5" style="fill:${c('muted')}">${esc(time)}</text>`
  return svg
}

export type TreeChunk = { key: string; svg: string; height: number; parts: Part[]; alt: string }

/** The key of the tree picture that holds `path`, or undefined when it isn't in the tree. */
export function chunkKeyOf(state: FilesState, path: string): string | undefined {
  const index = treeRows(state, DESKTOP_ROWS).rows.findIndex(row => row.path === path)
  return index < 0 ? undefined : `tree:${Math.floor(index / CHUNK) * CHUNK}`
}

/** The tree as pictures of up to CHUNK rows each. */
export function treeChunks(width: number, state: FilesState, hover: string, now: number): { chunks: TreeChunk[]; more: number } {
  const { rows, more } = treeRows(state, DESKTOP_ROWS)
  const chunks: TreeChunk[] = []
  for (let start = 0; start < rows.length; start += CHUNK) {
    const slice = rows.slice(start, start + CHUNK)
    const parts: Part[] = []
    let body = ''
    slice.forEach((row, index) => {
      const top = index * TREE_ROW
      const key = `row:${row.path}`
      parts.push({ key, leftPx: 2, widthPx: width - 4, topPx: top, heightPx: TREE_ROW })
      body += treeRow(width, row, top, hover === key, now, state.showSizes)
    })
    const height = slice.length * TREE_ROW
    chunks.push({ key: `tree:${start}`, svg: panel(width, height, body), height, parts,
      alt: slice.map(row => `${'  '.repeat(row.depth)}${row.isDir ? (row.isOpen ? '▾ ' : '▸ ') : ''}${row.name}${row.mark ? ` (${row.mark})` : ''}`).join('\n') })
  }
  return { chunks, more }
}

export const FOOTER_LINE = 30

/**
 * The footer, right-aligned, one line each: "● committed a1c9e42", "● pushed to main",
 * "● PR #482 created". Null when the turn did none of these.
 */
export function footerSvg(width: number, state: FilesState): { svg: string; height: number } | null {
  const lines = footerOf(state)
  if (!lines.length) return null
  let body = ''
  lines.forEach((line, index) => {
    const y = index * FOOTER_LINE + 21
    const codeW = line.code ? textWidth(line.code, 14) * 1.12 : 0
    const textRight = line.code ? width - 14 - codeW : width - 6
    if (line.code) body += `<text x="${width - 6}" y="${y}" text-anchor="end" ${MONO} font-size="14" style="fill:${c('muted')}">${esc(line.code)}</text>`
    body += `<text x="${textRight}" y="${y}" text-anchor="end" ${SANS} font-size="15.5" style="fill:${c('green')}">${esc(line.text)}</text>` +
      `<circle cx="${textRight - textWidth(line.text, 15.5) - 12}" cy="${y - 5}" r="4.5" style="fill:${c('green')}"/>`
  })
  const height = lines.length * FOOTER_LINE + 4
  return { svg: panel(width, height, body), height }
}

const MATCH_ROW = 38

/**
 * "Find a file" results: a header with the count and Clear, then each match with its badge, name
 * and folder. A row shows the file in the tree.
 */
export function matchesSvg(width: number, state: FilesState, hover: string): { svg: string; height: number; parts: Part[] } {
  const { query, matches, total, isLoading } = state.search
  const parts: Part[] = []
  const count = isLoading ? 'Looking…' : total === 0 ? `Nothing matches "${query.trim()}"`
    : total > matches.length ? `${matches.length} of ${total} matches` : `${total} ${total === 1 ? 'match' : 'matches'}`
  const clearW = textWidth('Clear', 14, true) + 22
  parts.push({ key: 'search:clear', leftPx: width - 20 - clearW, widthPx: clearW, topPx: 10, heightPx: 28 })
  let body = `<text x="20" y="30" ${SANS} font-size="12.5" font-weight="700" letter-spacing="1.1" style="fill:${c('muted')}">${fit(count.toUpperCase(), width - clearW - 60, 12.5, true)}</text>` +
    `<rect x="${width - 20 - clearW + 0.5}" y="10.5" width="${clearW - 1}" height="27" rx="13.5" style="fill:${hover === 'search:clear' ? c('card2') : 'none'};stroke:${c('line2')}"/>` +
    `<text x="${width - 20 - clearW / 2}" y="29" text-anchor="middle" ${SANS} font-size="14" font-weight="500" style="fill:${c('ink')}">Clear</text>`
  matches.forEach((path, index) => {
    const top = 46 + index * MATCH_ROW
    const mid = top + MATCH_ROW / 2
    const key = `match:${path}`
    parts.push({ key, leftPx: 8, widthPx: width - 16, topPx: top, heightPx: MATCH_ROW })
    if (hover === key) body += `<rect x="8" y="${top + 2}" width="${width - 16}" height="${MATCH_ROW - 4}" rx="10" style="fill:${c('card2')}"/>`
    const name = basename(path)
    const folder = dirname(path) === '.' ? '' : dirname(path)
    const mark = badge(40, mid, name)
    const nameX = 40 + mark.width + 10
    const nameW = Math.min(textWidth(name, 16, true), width - nameX - 30)
    body += mark.svg +
      `<text x="${nameX}" y="${mid + 5.5}" ${SANS} font-size="16" font-weight="700" style="fill:${c('ink')}">${fit(name, width - nameX - 30, 16, true)}</text>` +
      (folder && nameX + nameW + 60 < width - 20
        ? `<text x="${nameX + nameW + 10}" y="${mid + 5}" ${SANS} font-size="14.5" style="fill:${c('muted')}">${fit(folder, width - 20 - nameX - nameW - 20, 14.5)}</text>` : '')
  })
  const height = 46 + matches.length * MATCH_ROW + 10
  return { svg: panel(width, height, cardRect(width, height) + body), height, parts }
}

/** Shown in place of the tree: an empty folder, an unreadable one, or still loading. */
export function noteSvg(width: number, text: string): string {
  return panel(width, 40, `<text x="12" y="25" ${SANS} font-size="15" style="fill:${c('muted')}">${fit(text, width - 24, 15)}</text>`)
}
