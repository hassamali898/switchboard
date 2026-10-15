// Replay's desktop pictures (screen F4). Plain TypeScript, no engine,
// so they render in tests and in scripts/preview.ts.

import { MONO, SANS, SERIF, c, esc, eyebrow, fit, textWidth } from '../../ui/theme.ts'
import { panel, type Part } from '../../ui/kit.ts'
import { basename, dirname } from '../files/paths.ts'
import { withWords, type WordLine } from './diff.ts'
import {
  SHOWN_LINES, currentTurn, headline, plural, stepNotes, stepWhere, summaryOf, type ReplayState, type ReplayStep,
} from './model.ts'

/** "4 edits in 4 files" / "6 lines added, 6 removed", "New edits ready", and the turn switch. */
export function headerSvg(width: number, state: ReplayState, hover: string): { svg: string; height: number; parts: Part[] } {
  const summary = summaryOf(currentTurn(state))
  const parts: Part[] = []
  let body = `<text x="2" y="30" ${SERIF} font-size="27" font-weight="500" style="fill:${c('ink')}">${fit(headline(summary), width - 160, 27)}</text>`
  const added = `${plural(summary.add, 'line')} added,`
  body += `<text x="2" y="62" ${SANS} font-size="19" font-weight="600"><tspan style="fill:${c('green')}">${esc(added)}</tspan>` +
    `<tspan style="fill:${c('red')}"> ${esc(`${summary.del} removed`)}</tspan></text>`
  if (state.hasNew) {
    const label = 'New edits ready'
    const w = textWidth(label, 14, true) + 28
    const key = 'replay:new'
    parts.push({ key, leftPx: width - w - 2, widthPx: w, topPx: 8, heightPx: 30 })
    body += `<rect x="${width - w - 1.5}" y="8.5" width="${w - 1}" height="29" rx="14.5" style="fill:${hover === key ? c('pink') : c('pinkSoft')}"/>` +
      `<text x="${width - 2 - w / 2}" y="28" text-anchor="middle" ${SANS} font-size="14" font-weight="600" ` +
      `style="fill:${hover === key ? c('onprim') : c('pink')}">${label}</text>`
  }
  let height = 76
  if (state.turns.length > 1) {
    // Earlier turns stay for 3 turns: "Last turn · 1 of 3", with Earlier and Later.
    const which = state.turn === 0 ? 'Last turn' : state.turn === 1 ? 'The turn before' : 'Two turns before'
    body += `<text x="2" y="${height + 20}" ${SANS} font-size="15" style="fill:${c('muted')}">${esc(`${which} · ${state.turn + 1} of ${state.turns.length}`)}</text>`
    let x = width - 2
    const link = (key: string, label: string, isOn: boolean) => {
      const w = textWidth(label, 14.5, true) + 26
      x -= w
      if (isOn) parts.push({ key, leftPx: x, widthPx: w, topPx: height, heightPx: 30 })
      body += `<rect x="${x + 0.5}" y="${height + 0.5}" width="${w - 1}" height="29" rx="11" ` +
        `style="fill:${isOn && hover === key ? c('card2') : 'none'};stroke:${c('line2')}"/>` +
        `<text x="${x + w / 2}" y="${height + 20}" text-anchor="middle" ${SANS} font-size="14.5" font-weight="500" ` +
        `style="fill:${isOn ? c('ink') : c('faint')}">${label}</text>`
      x -= 8
    }
    link('turn:newer', 'Later', state.turn > 0)
    link('turn:older', 'Earlier', state.turn < state.turns.length - 1)
    height += 40
  }
  return { svg: panel(width, height, body), height, parts }
}

const STEP_H = 52
const STEP_GAP = 6

/** "THE EDITS, IN ORDER": numbered pills on a rail, the current one tinted pink. A row jumps to it. */
export function timelineSvg(width: number, steps: readonly ReplayStep[], current: number, hover: string): { svg: string; height: number; parts: Part[] } {
  const parts: Part[] = []
  let body = ''
  steps.forEach((step, index) => {
    const top = index * (STEP_H + STEP_GAP)
    const mid = top + STEP_H / 2
    const key = `step:${index}`
    const isOn = index === current
    parts.push({ key, leftPx: 0, widthPx: width, topPx: top, heightPx: STEP_H })
    if (index > 0) body += `<line x1="27" x2="27" y1="${top - STEP_GAP - 8}" y2="${top + 9}" style="stroke:${c('line2')}" stroke-width="2"/>`
    if (isOn || hover === key) {
      body += `<rect x="0" y="${top}" width="${width}" height="${STEP_H}" rx="${STEP_H / 2}" style="fill:${isOn ? c('pinkRow') : c('card2')}"/>`
    }
    body += isOn
      ? `<circle cx="27" cy="${mid}" r="17" style="fill:${c('pink')}"/>` +
        `<text x="27" y="${mid + 5.5}" text-anchor="middle" ${SANS} font-size="16" font-weight="700" fill="#1A0B14">${index + 1}</text>`
      : `<circle cx="27" cy="${mid}" r="16" style="fill:${c('pane')};stroke:${c('line2')}" stroke-width="2"/>` +
        `<text x="27" y="${mid + 5.5}" text-anchor="middle" ${SANS} font-size="16" style="fill:${c('muted')}">${index + 1}</text>`
    const add = `+${step.add}`
    const del = `−${step.del}`
    const numsW = textWidth(add, 17) + textWidth(del, 17) + 14
    const right = width - 16
    body += `<text x="${right}" y="${mid + 6}" text-anchor="end" ${SANS} font-size="17" style="fill:${c('red')}">${del}</text>` +
      `<text x="${right - textWidth(del, 17) - 12}" y="${mid + 6}" text-anchor="end" ${SANS} font-size="17" style="fill:${c('green')}">${add}</text>`
    const name = basename(step.path)
    const nameX = 60
    const room = right - numsW - nameX - 12
    const nameW = Math.min(textWidth(name, 18, isOn), room)
    const where = step.isOutside ? `in ${dirname(step.path)}` : dirname(step.path) === '.' ? '' : `in ${dirname(step.path)}`
    const tag = [where, step.agent ? `by ${step.agent}` : '', step.isAfterTurn ? 'after the turn' : ''].filter(Boolean).join(' · ')
    body += `<text x="${nameX}" y="${mid + 6}" ${SANS} font-size="18" font-weight="${isOn ? 700 : 400}" style="fill:${c('ink')}">${fit(name, room, 18, isOn)}</text>`
    if (tag && nameX + nameW + 70 < right - numsW) {
      body += `<text x="${nameX + nameW + 12}" y="${mid + 5.5}" ${SANS} font-size="16" style="fill:${c('muted')}">` +
        `${fit(tag, right - numsW - nameX - nameW - 24, 16)}</text>`
    }
  })
  const height = Math.max(STEP_H, steps.length * (STEP_H + STEP_GAP) - STEP_GAP)
  return { svg: panel(width, height, body), height, parts }
}

const DIFF_ROW = 30
const DIFF_SIZE = 14.5
/** A monospace character's advance, as a share of the font size. */
const MONO_ADVANCE = 0.6

/** One diff row at `top` inside the box: tint, marker, text, and the changed words' marks. */
function diffRow(line: WordLine, top: number, boxW: number): string {
  const charW = DIFF_SIZE * MONO_ADVANCE
  const textX = 36
  const maxChars = Math.max(8, Math.floor((boxW - textX - 12) / charW))
  if (line.op === '~') {
    return `<text x="${boxW / 2}" y="${top + 20}" text-anchor="middle" ${MONO} font-size="${DIFF_SIZE}" style="fill:${c('faint')}">⋯</text>`
  }
  const isDel = line.op === '-'
  const isAdd = line.op === '+'
  let svg = isDel || isAdd ? `<rect x="0" y="${top}" width="${boxW}" height="${DIFF_ROW}" style="fill:${c(isDel ? 'delBg' : 'addBg')}"/>` : ''
  if (isDel || isAdd) {
    svg += `<text x="14" y="${top + 20}" ${MONO} font-size="${DIFF_SIZE}" style="fill:${c(isDel ? 'red' : 'green')}">${isDel ? '−' : '+'}</text>`
  }
  const text = line.text.replace(/\t/g, '  ')
  const isCut = text.length > maxChars
  const shown = isCut ? `${text.slice(0, maxChars - 1)}…` : text
  if (line.segments && (isDel || isAdd)) {
    let at = 0
    for (const segment of line.segments) {
      const length = segment.text.replace(/\t/g, '  ').length
      const from = Math.min(at, maxChars)
      const to = Math.min(at + length, maxChars)
      if (segment.isChanged && to > from && segment.text.trim()) {
        svg += `<rect x="${textX + from * charW - 1}" y="${top + 5}" width="${(to - from) * charW + 2}" height="${DIFF_ROW - 10}" rx="4" ` +
          `style="fill:${c(isDel ? 'delW' : 'addW')}"/>`
      }
      at += length
    }
  }
  svg += `<text x="${textX}" y="${top + 20}" ${MONO} font-size="${DIFF_SIZE}" xml:space="preserve" ` +
    `style="fill:${line.op === ' ' ? c('muted') : c('ink')}">${esc(shown)}</text>`
  return svg
}

/** "EDIT k OF N", the file, where it is, any notes, the diff, the legend. */
export function editSvg(width: number, state: ReplayState, hover: string): { svg: string; height: number; parts: Part[] } {
  const turn = currentTurn(state)
  const step = turn?.steps[state.step]
  const parts: Part[] = []
  if (!turn || !step) return { svg: panel(width, 40, ''), height: 40, parts }
  let body = eyebrow(`Edit ${state.step + 1} of ${turn.steps.length}`, 2, 16, c('pink'), 13)
  body += `<text x="2" y="52" ${SANS} font-size="25" font-weight="600" style="fill:${c('ink')}">${fit(basename(step.path), width - 4, 25, true)}</text>`
  body += `<text x="2" y="80" ${SANS} font-size="16.5" style="fill:${c('muted')}">${fit(stepWhere(step), width - 4, 16.5)}</text>`
  let y = 96
  for (const note of stepNotes(step)) {
    body += `<text x="2" y="${y + 6}" ${SANS} font-size="15" font-weight="600" style="fill:${c('amber')}">${fit(note, width - 4, 15, true)}</text>`
    y += 24
  }
  y += 6

  // The diff box.
  const all = withWords(step.lines)
  const lines = state.isFull ? all : all.slice(0, SHOWN_LINES)
  const message = step.kind === 'binary' ? 'Binary file changed' : !lines.length ? (step.kind === 'created' ? 'Empty file' : 'No line changes') : ''
  const rows = message ? 1 : lines.length
  const boxH = rows * DIFF_ROW + 12
  let box = message
    ? `<text x="18" y="${6 + 20}" ${SANS} font-size="15.5" style="fill:${c('muted')}">${esc(message)}</text>`
    : lines.map((line, index) => diffRow(line, 6 + index * DIFF_ROW, width)).join('')
  box = `<clipPath id="box"><rect x="0" y="${y}" width="${width}" height="${boxH}" rx="12"/></clipPath>` +
    `<g clip-path="url(#box)"><g transform="translate(0,${y})">${box}</g></g>` +
    `<rect x="0.5" y="${y + 0.5}" width="${width - 1}" height="${boxH - 1}" rx="12" style="fill:none;stroke:${c('line2')}"/>`
  body += box
  y += boxH + 12

  // More than the box shows: Show full diff; past what was kept: say so.
  const hidden = all.length - lines.length
  if (hidden > 0) {
    const label = `Show full diff · ${plural(hidden, 'more line')}`
    const w = textWidth(label, 14.5, true) + 28
    const key = 'replay:full'
    parts.push({ key, leftPx: 0, widthPx: w, topPx: y, heightPx: 34 })
    body += `<rect x="0.5" y="${y + 0.5}" width="${w - 1}" height="33" rx="11" style="fill:${hover === key ? c('card2') : 'none'};stroke:${c('line2')}"/>` +
      `<text x="${w / 2}" y="${y + 22}" text-anchor="middle" ${SANS} font-size="14.5" font-weight="500" style="fill:${c('ink')}">${esc(label)}</text>`
    y += 46
  } else if (step.cut > 0) {
    body += `<text x="2" y="${y + 14}" ${SANS} font-size="14.5" style="fill:${c('muted')}">${esc(`${plural(step.cut, 'more line')} not kept`)}</text>`
    y += 26
  }

  // The legend.
  let x = 0
  const item = (label: string, square: (at: number) => string) => {
    if (x > 0 && x + 28 + textWidth(label, 15.5) > width) {
      x = 0
      y += 30
    }
    body += square(x) + `<text x="${x + 28}" y="${y + 16}" ${SANS} font-size="15.5" style="fill:${c('muted')}">${label}</text>`
    x += 28 + textWidth(label, 15.5) + 18
  }
  const sq = (fill: string, stroke: string) => (at: number) =>
    `<rect x="${at + 1}" y="${y + 1}" width="18" height="18" rx="5" style="fill:${fill};stroke:${stroke}" stroke-width="2"/>`
  item('Removed', sq(c('delBg'), c('red')))
  item('Added', sq(c('addBg'), c('green')))
  item('Changed word', at => `<clipPath id="cw"><rect x="${at}" y="${y}" width="20" height="20" rx="5"/></clipPath>` +
    `<g clip-path="url(#cw)"><rect x="${at}" y="${y}" width="10" height="20" style="fill:${c('delW')}"/>` +
    `<rect x="${at + 10}" y="${y}" width="10" height="20" style="fill:${c('addW')}"/></g>`)
  item('Unchanged', sq('none', c('line2')))
  const height = y + 30
  return { svg: panel(width, height, body), height, parts }
}

const NAV_H = 52

/** Previous edit and Next edit, with the keys that do the same. */
export function navSvg(width: number, state: ReplayState, hover: string): { svg: string; height: number; parts: Part[] } {
  const total = currentTurn(state)?.steps.length ?? 0
  const parts: Part[] = []
  let x = 0
  let body = ''
  const button = (key: string, label: string, isPrimary: boolean, isOn: boolean) => {
    const w = textWidth(label, 18, true) + 52
    if (isOn) parts.push({ key, leftPx: x, widthPx: w, topPx: 0, heightPx: NAV_H })
    const isHover = isOn && hover === key
    const fill = isPrimary && isOn ? c('prim') : isHover ? c('card2') : 'none'
    const stroke = isPrimary && isOn ? c('prim') : c('line2')
    body += `<rect x="${x + 0.5}" y="0.5" width="${w - 1}" height="${NAV_H - 1}" rx="11" style="fill:${fill};stroke:${stroke}"/>` +
      (isPrimary && isOn && isHover ? `<rect x="${x}" y="0" width="${w}" height="${NAV_H}" rx="11" fill="#FFFFFF" fill-opacity=".14"/>` : '') +
      `<text x="${x + w / 2}" y="${NAV_H / 2 + 6.5}" text-anchor="middle" ${SANS} font-size="18" font-weight="600" ` +
      `style="fill:${isPrimary && isOn ? c('onprim') : isOn ? c('muted') : c('faint')}">${label}</text>`
    x += w + 16
  }
  button('replay:prev', 'Previous edit', false, state.step > 0)
  button('replay:next', 'Next edit', true, state.step < total - 1)
  if (x + 60 < width) body += `<text x="${width - 2}" y="${NAV_H / 2 + 5}" text-anchor="end" ${SANS} font-size="14" style="fill:${c('faint')}">p · n</text>`
  return { svg: panel(width, NAV_H + 4, body), height: NAV_H + 4, parts }
}

/** The empty pane: nothing recorded yet. */
export function emptySvg(width: number): string {
  return panel(width, 84,
    `<text x="2" y="30" ${SERIF} font-size="24" font-weight="500" style="fill:${c('ink')}">No edits yet</text>` +
    `<text x="2" y="62" ${SANS} font-size="16" style="fill:${c('muted')}">${fit('After a turn that edits files, its edits show here, one at a time.', width - 4, 16)}</text>`)
}
