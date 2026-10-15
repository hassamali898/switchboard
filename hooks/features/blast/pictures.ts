// Blast Radius's desktop pictures (screen F5): the report card and the decision row. Plain
// TypeScript, no engine, so they render in tests and in scripts/preview.ts.

import { MONO, SANS, c, esc, fit, icon, textWidth, type TokenName } from '../../ui/theme.ts'
import { panel, type Part } from '../../ui/kit.ts'
import type { RiskKind } from './classify.ts'
import { countdown, visibleRows, type BlastHeld } from './model.ts'

type Run = { text: string; font: 'mono' | 'sans'; color: TokenName; isBold: boolean }

const TITLE = 22
const TITLE_LINE = 30
const width = (run: Run, text = run.text) => (run.font === 'mono' ? text.length * TITLE * 0.6 : textWidth(text, TITLE, run.isBold))

/** Lays styled runs out word by word into lines `maxPx` wide. */
function wrapRuns(runs: readonly Run[], maxPx: number): { run: Run; text: string; x: number }[][] {
  const lines: { run: Run; text: string; x: number }[][] = [[]]
  let x = 0
  const space = textWidth(' ', TITLE)
  for (const run of runs) {
    for (const word of run.text.split(/\s+/).filter(Boolean)) {
      const w = width(run, word)
      if (x > 0 && x + space + w > maxPx) {
        lines.push([])
        x = 0
      }
      if (x > 0) x += space
      lines[lines.length - 1]!.push({ run, text: word, x })
      x += w
    }
  }
  return lines
}

/** Plain text wrapped into lines `maxPx` wide at `fontSize`. */
function wrapText(text: string, maxPx: number, fontSize: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (line && textWidth(next, fontSize) * 0.94 > maxPx) {
      lines.push(line)
      line = word
    } else line = next
  }
  if (line) lines.push(line)
  return lines
}

const TILE_ICON: Record<RiskKind, string> = {
  'rm': 'trash', 'find-delete': 'trash', 'xargs-rm': 'trash', 'git-clean': 'trash',
  'git-reset': 'undo', 'git-checkout': 'undo', 'git-push-force': 'upload', 'migrate': 'database',
}

const ROW_H = 40
const PAD = 22

/** The report card: what the command will do, where, the warning, and the rows with their sizes. */
export function reportSvg(paneWidth: number, held: BlastHeld, kind: RiskKind): { svg: string; height: number; parts: Part[] } {
  const report = held.report
  const parts: Part[] = []
  if (!report) {
    const body = `<rect x="0.5" y="0.5" width="${paneWidth - 1}" height="89" rx="16" style="fill:${c('card')};stroke:${c('line')}"/>` +
      `<text x="${PAD}" y="52" ${SANS} font-size="17" style="fill:${c('muted')}">Measuring what this would change…</text>`
    return { svg: panel(paneWidth, 90, body), height: 90, parts }
  }
  const inner = paneWidth - PAD * 2
  let body = ''
  // The red tile and the title, wrapped beside it.
  body += `<rect x="${PAD}" y="${PAD}" width="60" height="60" rx="14" style="fill:${c('redSq')}"/>` + icon(TILE_ICON[kind], PAD + 15, PAD + 15, 30, c('red'))
  const titleX = PAD + 60 + 20
  const runs: Run[] = [
    { text: report.command, font: 'mono', color: 'ink', isBold: true },
    { text: report.verb, font: 'sans', color: 'muted', isBold: false },
    { text: report.amount, font: 'sans', color: 'red', isBold: true },
  ]
  const lines = wrapRuns(runs, paneWidth - PAD - titleX).slice(0, 4)
  lines.forEach((line, index) => {
    const y = PAD + 24 + index * TITLE_LINE
    // Sans words of one style on one line are drawn as one text, so the font sets their spacing; mono
    // words keep their own places (the fallback mono fonts differ in width).
    const pieces: { run: Run; text: string; x: number }[] = []
    for (const word of line) {
      const last = pieces[pieces.length - 1]
      if (last && last.run === word.run && word.run.font === 'sans') last.text += ` ${word.text}`
      else pieces.push({ ...word })
    }
    for (const piece of pieces) {
      body += `<text x="${titleX + piece.x}" y="${y}" ${piece.run.font === 'mono' ? MONO : SANS} font-size="${TITLE}" xml:space="preserve" ` +
        `font-weight="${piece.run.isBold ? 700 : 400}" style="fill:${c(piece.run.color)}">${esc(piece.text)}</text>`
    }
  })
  let y = PAD + 24 + (lines.length - 1) * TITLE_LINE + 28
  const where = [report.where, held.agent ? `from agent ${held.agent}` : ''].filter(Boolean).join(' · ')
  body += `<text x="${titleX}" y="${y}" ${SANS} font-size="16" style="fill:${c('muted')}">${fit(where, paneWidth - PAD - titleX, 16)}</text>`
  y = Math.max(y + 14, PAD + 60 + 6)

  // The warning box.
  if (report.warn) {
    const warnLines = wrapText(report.warn, inner - 56, 15.5)
    const boxH = 24 + warnLines.length * 22
    y += 12
    body += `<rect x="${PAD + 0.5}" y="${y + 0.5}" width="${inner - 1}" height="${boxH - 1}" rx="12" style="fill:${c('redBox')};stroke:${c('redLine')}"/>` +
      icon('shield', PAD + 16, y + boxH / 2 - 11, 22, c('red'))
    warnLines.forEach((line, index) => {
      body += `<text x="${PAD + 48}" y="${y + 28 + index * 22}" ${SANS} font-size="15.5" ` +
        `style="fill:${c('red')}">${esc(line)}</text>`
    })
    y += boxH
  }

  // The rows: name, count, size, and a bar against the whole.
  const { rows, moreLine } = visibleRows(report, held.isExpanded)
  if (rows.length) {
    y += 18
    body += `<line x1="${PAD}" x2="${paneWidth - PAD}" y1="${y + 0.5}" y2="${y + 0.5}" style="stroke:${c('line')}"/>`
    y += 6
    const hasBars = rows.some(row => row.bar >= 0)
    const barW = hasBars ? Math.min(100, Math.round(inner * 0.2)) : 0
    const sizeW = Math.min(120, Math.max(0, ...rows.map(row => (row.size ? textWidth(row.size, 15.5, true) : 0))))
    const countW = Math.min(110, Math.max(0, ...rows.map(row => (row.count ? textWidth(row.count, 15) : 0))))
    const right = paneWidth - PAD
    const barX = right - barW
    const sizeRight = hasBars ? barX - 12 : right
    const countRight = sizeRight - (sizeW ? sizeW + 12 : 0)
    const nameRight = countRight - (countW ? countW + 12 : 0)
    const struck = new Set(held.struck)
    for (const row of rows) {
      const mid = y + ROW_H / 2
      const x = PAD + (row.isIndented ? 30 : 0)
      const isGone = struck.has(row.path)
      const ink = isGone ? c('faint') : c('ink')
      const glyph = row.kind === 'folder' ? 'folder' : row.kind === 'commit' ? 'commit' : row.kind === 'migration' ? 'database' : 'file'
      const glyphSize = row.kind === 'folder' ? 20 : 18
      body += icon(glyph, x, mid - glyphSize / 2, glyphSize, c(row.kind === 'folder' ? 'muted' : 'faint'))
      const nameX = x + glyphSize + 10
      const isBold = row.kind === 'folder'
      let name = ''
      if (row.kind === 'commit') {
        const [sha = '', ...message] = row.name.split(' ')
        const shaW = sha.length * 15 * 0.6
        name = `<text x="${nameX}" y="${mid + 5}" ${MONO} font-size="15" style="fill:${c('muted')}">${esc(sha)}</text>` +
          `<text x="${nameX + shaW + 10}" y="${mid + 5.5}" ${SANS} font-size="16" style="fill:${ink}">${fit(message.join(' '), nameRight - nameX - shaW - 16, 16)}</text>`
      } else {
        name = `<text x="${nameX}" y="${mid + 5.5}" ${SANS} font-size="16" font-weight="${isBold ? 700 : 400}" style="fill:${ink}">` +
          `${fit(row.name, nameRight - nameX - 6, 16, isBold)}</text>`
      }
      body += name
      if (isGone) {
        const goneW = Math.min(textWidth(row.name, 16, isBold), nameRight - nameX - 6)
        body += `<line x1="${nameX - 2}" x2="${nameX + goneW + 2}" y1="${mid}" y2="${mid}" style="stroke:${c('red')}" stroke-width="1.6"/>`
      }
      if (row.count) {
        const isLines = /^\+\d+ −\d+$/.test(row.count)
        if (isLines) {
          const [add, del] = row.count.split(' ')
          body += `<text x="${countRight}" y="${mid + 5}" text-anchor="end" ${SANS} font-size="15" style="fill:${c('red')}">${esc(del!)}</text>` +
            `<text x="${countRight - textWidth(del!, 15) - 6}" y="${mid + 5}" text-anchor="end" ${SANS} font-size="15" style="fill:${c('green')}">${esc(add!)}</text>`
        } else {
          body += `<text x="${countRight}" y="${mid + 5}" text-anchor="end" ${SANS} font-size="15" style="fill:${c('muted')}">${esc(row.count)}</text>`
        }
      }
      if (row.size) {
        body += `<text x="${sizeRight}" y="${mid + 5}" text-anchor="end" ${SANS} font-size="15.5" font-weight="${row.kind === 'folder' ? 600 : 400}" ` +
          `style="fill:${row.kind === 'folder' ? ink : c('muted')}">${esc(row.size)}</text>`
      }
      if (hasBars && row.bar >= 0) {
        body += `<rect x="${barX}" y="${mid - 6}" width="${barW}" height="12" rx="6" style="fill:${c('track')}"/>` +
          `<rect x="${barX}" y="${mid - 6}" width="${Math.max(3, Math.min(1, row.bar) * barW)}" height="12" rx="6" ` +
          `style="fill:${c(row.kind === 'folder' ? 'bar' : 'bar2')}"/>`
      }
      y += ROW_H
    }
  }
  if (moreLine) {
    body += `<text x="${PAD}" y="${y + 20}" ${SANS} font-size="16" style="fill:${c('muted')}">${esc(moreLine)}</text>`
    y += 30
  }
  if (report.note) {
    const noteLines = wrapText(report.note, inner, 15)
    y += 6
    noteLines.forEach((line, index) => {
      body += `<text x="${PAD}" y="${y + 16 + index * 21}" ${SANS} font-size="15" style="fill:${c('muted')}">${esc(line)}</text>`
    })
    y += noteLines.length * 21 + 4
  }
  const height = y + PAD - 4
  const card = `<rect x="0.5" y="0.5" width="${paneWidth - 1}" height="${height - 1}" rx="16" style="fill:${c('card')};stroke:${c('line')}"/>`
  return { svg: panel(paneWidth, height, card + body), height, parts }
}

const BUTTON_H = 48

/**
 * "Show 3 more", then the decision: the action (clay), Cancel (focused), "Held by Blast Radius". While
 * it runs, and after, the row says what happened instead.
 */
export function actionsSvg(paneWidth: number, held: BlastHeld, queued: number, hover: string): { svg: string; height: number; parts: Part[] } {
  const parts: Part[] = []
  let body = ''
  let y = 0
  const report = held.report
  if (report) {
    const { hidden } = visibleRows(report, held.isExpanded)
    const canFold = held.isExpanded && report.rows.length > visibleRows(report, false).rows.length
    if (hidden > 0 || canFold) {
      const label = hidden > 0 ? `Show ${hidden} more` : 'Show fewer'
      const w = textWidth(label, 17, true) + 8
      parts.push({ key: 'blast:more', leftPx: 0, widthPx: w, topPx: 0, heightPx: 30 })
      body += `<text x="2" y="21" ${SANS} font-size="17" font-weight="600" style="fill:${hover === 'blast:more' ? c('ink') : c('muted')}">${label}</text>`
      y = 42
    }
  }
  if (held.phase === 'waiting' && report) {
    // Room above the buttons for Cancel's focus ring (it sits 3.5 px outside the button).
    y += 6
    let x = 0
    const button = (key: string, label: string, isPrimary: boolean, isFocused: boolean) => {
      const w = textWidth(label, 17, true) + 48
      parts.push({ key, leftPx: x, widthPx: w, topPx: y, heightPx: BUTTON_H })
      const isHover = hover === key
      if (isFocused) body += `<rect x="${x - 3.5}" y="${y - 3.5}" width="${w + 7}" height="${BUTTON_H + 7}" rx="13.5" style="fill:none;stroke:${c('focus')}" stroke-width="2"/>`
      body += `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${BUTTON_H - 1}" rx="11" ` +
        `style="fill:${isPrimary ? c('prim') : isHover ? c('card2') : 'none'};stroke:${isPrimary ? c('prim') : c('line2')}"/>` +
        (isPrimary && isHover ? `<rect x="${x}" y="${y}" width="${w}" height="${BUTTON_H}" rx="11" fill="#FFFFFF" fill-opacity=".14"/>` : '') +
        `<text x="${x + w / 2}" y="${y + BUTTON_H / 2 + 6}" text-anchor="middle" ${SANS} font-size="17" font-weight="600" ` +
        `style="fill:${isPrimary ? c('onprim') : c('muted')}">${esc(label)}</text>`
      x += w + 16
    }
    button('blast:proceed', report.action, true, false)
    button('blast:cancel', 'Cancel', false, true)
    const left = countdown(held)
    const held1 = left ? `Runs by itself in ${left}` : 'Held by Blast Radius'
    const extra = queued ? ` · ${queued} more held` : ''
    if (x + textWidth(held1 + extra, 16) < paneWidth) {
      body += `<text x="${x + 4}" y="${y + BUTTON_H / 2 + 6}" ${SANS} font-size="16" style="fill:${c('muted')}">${esc(held1 + extra)}</text>`
      y += BUTTON_H + 8
    } else {
      body += `<text x="2" y="${y + BUTTON_H + 30}" ${SANS} font-size="16" style="fill:${c('muted')}">${esc(held1 + extra)}</text>`
      y += BUTTON_H + 42
    }
  } else {
    const [text, color]: [string, TokenName] = held.phase === 'measuring' ? ['Measuring…', 'muted']
      : held.phase === 'running' ? ['Running it…', 'muted']
      : held.phase === 'done' ? [held.struck.length ? `Done: ${held.struck.length} ${held.struck.length === 1 ? 'path' : 'paths'} gone` : 'Done', 'green']
      : ["Didn't run", 'red']
    body += `<text x="2" y="${y + 24}" ${SANS} font-size="17" font-weight="600" style="fill:${c(color)}">${esc(text)}</text>`
    y += 36
  }
  return { svg: panel(paneWidth, Math.max(1, y), body), height: Math.max(1, y), parts }
}
