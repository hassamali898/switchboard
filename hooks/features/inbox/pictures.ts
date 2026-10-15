// The Inbox's pictures: the needs-you card and the bell above the prompt (screen 1), the Inbox pane
// (screen 3), and the reply card (screen 4). Plain TypeScript, no engine.

import { MONO, SANS, SERIF, SVG_STYLE, c, esc, eyebrow, fit, icon, textWidth, type TokenName } from '../../ui/theme.ts'
import { panel, pill, type Part, type PillTone } from '../../ui/kit.ts'
import { BADGE, SOURCE_NAME, ago, rowText, sourcesSummary, newToday, needsYou, type InboxItem, type InboxState } from './model.ts'

const BADGE_TONE: Record<string, { fg: TokenName; bg: TokenName }> = {
  slack: { fg: 'slack', bg: 'slackSoft' }, gmail: { fg: 'red', bg: 'redSoft' }, calendar: { fg: 'amber', bg: 'amberSoft' },
  github: { fg: 'muted', bg: 'card2' }, jira: { fg: 'blue', bg: 'blueSoft' },
}

/** SLACK, MAIL, CAL, GH, JIRA: the monospace source badge at `x`, centred on `cy`. */
export function sourceBadge(x: number, cy: number, source: string): { svg: string; width: number } {
  const label = BADGE[source as keyof typeof BADGE] ?? source.slice(0, 4).toUpperCase()
  const tone = BADGE_TONE[source] ?? { fg: 'muted', bg: 'card2' }
  const width = Math.max(40, label.length * 7.2 + 12)
  return {
    width,
    svg: `<rect x="${x}" y="${cy - 11}" width="${width}" height="22" rx="6" style="fill:${c(tone.bg)}"/>` +
      `<text x="${x + width / 2}" y="${cy + 4}" text-anchor="middle" ${MONO} font-size="10.5" font-weight="700" style="fill:${c(tone.fg)}">${esc(label)}</text>`,
  }
}

/** A picture on the band's own gray. */
const bandPicture = (width: number, height: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${SVG_STYLE}` +
  `<rect width="${width}" height="${height}" style="fill:${c('band')}"/>${body}</svg>`

export function wrap(text: string, maxPx: number, size: number, isBold = false): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (line && textWidth(next, size, isBold) * 0.95 > maxPx) {
      lines.push(line)
      line = word
    } else line = next
  }
  if (line) lines.push(line)
  return lines
}

/** At most `count` lines; the last one ends in "…" when there was more. */
export function lines(text: string, maxPx: number, size: number, count: number, isBold = false): string[] {
  const all = wrap(text.replace(/\s+/g, ' ').trim(), maxPx, size, isBold)
  if (all.length <= count) return all
  const kept = all.slice(0, count)
  kept[count - 1] = fit(`${kept[count - 1]} ${all[count]}`, maxPx, size, isBold)
  if (!kept[count - 1]!.endsWith('…')) kept[count - 1] = `${kept[count - 1]}…`
  return kept
}

export type Look = 'primary' | 'outline' | 'text'

/** Buttons that wrap between `x0` and `right`; each `[key, label, look]`. */
export function buttons(list: readonly [string, string, Look][], x0: number, right: number, top: number, hover: string,
                 h = 40, size = 14.5): { body: string; parts: Part[]; bottom: number; endX: number } {
  const parts: Part[] = []
  let body = ''
  let x = x0
  let y = top
  for (const [key, label, look] of list) {
    const w = Math.round(textWidth(label, size, true) * 0.92) + (look === 'text' ? 18 : 30)
    if (x > x0 && x + w > right) {
      x = x0
      y += h + 8
    }
    parts.push({ key, leftPx: x, widthPx: w, topPx: y, heightPx: h })
    const isHover = hover === key
    const fill = look === 'primary' ? c('prim') : isHover ? c('card2') : 'none'
    const stroke = look === 'primary' ? c('prim') : look === 'outline' ? c('line2') : 'none'
    body += `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" rx="11" style="fill:${fill};stroke:${stroke}"/>` +
      (look === 'primary' && isHover ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="11" fill="#FFFFFF" fill-opacity=".14"/>` : '') +
      `<text x="${x + w / 2}" y="${y + h / 2 + size / 3}" text-anchor="middle" ${SANS} font-size="${size}" font-weight="600" ` +
      `style="fill:${look === 'primary' ? c('onprim') : look === 'text' ? c('muted') : c('ink')}">${esc(label)}</text>`
    x += w + 10
  }
  return { body, parts, bottom: y + h, endX: x }
}

const frame = (width: number, height: number, radius = 20) =>
  `<rect x="0.75" y="0.75" width="${width - 1.5}" height="${height - 1.5}" rx="${radius}" style="fill:${c('surface')};stroke:${c('frame')}" stroke-width="1.5"/>`

// ---- Screen 1: a coding session ---------------------------------------------------------------------

/** "Needs you now · Slack": the Critical item, with who and when. */
export function needsCardSvg(width: number, item: InboxItem, now: number): { svg: string; height: number } {
  const pad = 18
  const x0 = pad + 46 + 18
  const textW = width - x0 - pad
  const title = lines(item.title || item.body, textW, 19, 2)
  const sub = fit([item.from.name, item.source === 'gmail' ? '' : item.kind === 'dm' ? 'direct message' : item.kind, `${ago(item.receivedAt, now)} ago`]
    .filter(Boolean).join(' · '), textW, 14.5)
  let body = `<rect x="${pad}" y="${pad}" width="46" height="46" rx="14" style="fill:${c('amberSoft')}"/>` +
    icon('bell', pad + 11, pad + 11, 24, c('amber')) +
    eyebrow(`Needs you now · ${SOURCE_NAME[item.source]}`, x0, pad + 13, c('amber'), 12.5)
  title.forEach((line, index) => {
    body += `<text x="${x0}" y="${pad + 40 + index * 25}" ${SERIF} font-size="19" font-weight="500" style="fill:${c('ink')}">${esc(line)}</text>`
  })
  const subY = pad + 40 + (title.length - 1) * 25 + 24
  body += `<text x="${x0}" y="${subY}" ${SANS} font-size="14.5" style="fill:${c('muted')}">${esc(sub)}</text>`
  const height = subY + pad - 2
  return { svg: bandPicture(width, height, frame(width, height) + body), height }
}

/** "🔔 8 in Inbox" ending at `right`, centred on `cy`, as a part. */
function bell(right: number, cy: number, count: number, hover: string): { body: string; part: Part } {
  const label = 'in Inbox'
  const num = String(count)
  const w = 22 + 8 + textWidth(num, 14.5, true) + 6 + textWidth(label, 14.5) + 20
  const x = right - w
  const isHover = hover === 'inbox:bell'
  return {
    part: { key: 'inbox:bell', leftPx: x, widthPx: w, topPx: cy - 17, heightPx: 34 },
    body: `<rect x="${x + 0.5}" y="${cy - 16.5}" width="${w - 1}" height="33" rx="16.5" style="fill:${isHover ? c('card2') : c('card')};stroke:${c('line')}"/>` +
      icon('bell', x + 10, cy - 9, 18, c('muted')) +
      `<text x="${x + 36}" y="${cy + 5}" ${SANS} font-size="14.5" xml:space="preserve"><tspan font-weight="700" style="fill:${c('ink')}">${num}</tspan>` +
      `<tspan style="fill:${c('muted')}"> ${label}</tspan></text>`,
  }
}

/** Open in Inbox, Remind me in 1 hour, Dismiss (when a card shows), and the bell at the right. */
export function needsButtonsSvg(width: number, hasCard: boolean, count: number, hover: string): { svg: string; height: number; parts: Part[] } {
  const bellPart = bell(width - 2, 21, count, hover)
  const room = width - bellPart.part.widthPx - 16
  const row = hasCard
    ? buttons([['inbox:open', 'Open in Inbox', 'primary'], ['inbox:remind', 'Remind me in 1 hour', 'outline'], ['inbox:dismiss', 'Dismiss', 'text']],
      0, room, 1, hover)
    : { body: '', parts: [], bottom: 42, endX: 0 }
  const height = Math.max(row.bottom, 42) + 2
  return { svg: bandPicture(width, height, row.body + bellPart.body), height, parts: [...row.parts, bellPart.part] }
}

// ---- Screen 3: the Inbox pane ------------------------------------------------------------------------

export const cardBox = (width: number, height: number) =>
  `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="16" style="fill:${c('card')};stroke:${c('line')}"/>`

/** "Right now · 2 need you · 8 new today", the sources, today's cost, and the legend. */
export function statusSvg(width: number, state: InboxState, now: number): { svg: string; height: number } {
  const pad = 18
  const needs = needsYou(state).length
  const { live, problem } = sourcesSummary(state)
  let body = cardBox(width, 168) +
    `<rect x="${pad}" y="${pad}" width="50" height="50" rx="14" style="fill:${c('amberSoft')}"/>` + icon('bell', pad + 13, pad + 13, 24, c('amber')) +
    eyebrow('Right now', pad + 68, pad + 14, c('amber'), 12.5) +
    `<text x="${pad + 68}" y="${pad + 40}" ${SERIF} font-size="21" font-weight="500" style="fill:${c('ink')}">${needs ? `${needs} need${needs === 1 ? 's' : ''} you` : 'Nothing needs you'}</text>` +
    `<text x="${pad + 68}" y="${pad + 62}" ${SANS} font-size="14.5" style="fill:${c('muted')}">${newToday(state, now)} new today${state.mode === 'demo' ? ' · demo items' : ''}</text>` +
    `<rect x="${pad}" y="${pad + 80}" width="${width - pad * 2}" height="1" style="fill:${c('line')}"/>`
  const sourcesText = problem && !live ? `${SOURCE_NAME[problem.source as keyof typeof SOURCE_NAME] ?? problem.source}: ${problem.message}`
    : `${live} source${live === 1 ? '' : 's'} live${problem ? ` · ${SOURCE_NAME[problem.source as keyof typeof SOURCE_NAME] ?? problem.source} needs setup` : ''}`
  const cost = `$${state.costToday.toFixed(2)} today on Haiku`
  body += `<circle cx="${pad + 4}" cy="${pad + 103}" r="4" style="fill:${live ? c('green') : c('amber')}"/>` +
    `<text x="${pad + 16}" y="${pad + 108}" ${SANS} font-size="15" font-weight="700" style="fill:${c('ink')}">${esc(fit(sourcesText, width - pad * 2 - 16 - textWidth(cost, 14) - 16, 15, true))}</text>` +
    `<text x="${width - pad}" y="${pad + 108}" text-anchor="end" ${SANS} font-size="14" style="fill:${c('muted')}">${esc(cost)}</text>`
  let x = pad
  for (const [label, color] of [['Needs you', 'amber'], ['Claude drafted', 'teal'], ['Handled by a rule', 'green']] as const) {
    body += `<circle cx="${x + 5}" cy="${pad + 128}" r="5" style="fill:${c(color)}"/>` +
      `<text x="${x + 16}" y="${pad + 133}" ${SANS} font-size="14" style="fill:${c('muted')}">${label}</text>`
    x += 16 + textWidth(label, 14) + 20
  }
  return { svg: panel(width, 168, body), height: 168 }
}

/** All 8 · Slack 3 · Gmail 2: the source filters, the chosen one filled. */
export function filtersSvg(width: number, list: readonly { key: string; label: string; count: number }[], selected: string, hover: string):
  { svg: string; height: number; parts: Part[] } {
  const parts: Part[] = []
  let body = ''
  let x = 0
  let y = 0
  for (const one of list) {
    const label = `${one.label} ${one.count}`
    const w = Math.round(textWidth(label, 14.5, true) * 0.95) + 30
    if (x > 0 && x + w > width) {
      x = 0
      y += 46
    }
    const key = `inbox:filter:${one.key}`
    parts.push({ key, leftPx: x, widthPx: w, topPx: y, heightPx: 38 })
    const isOn = selected === one.key
    body += `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="37" rx="11" style="fill:${isOn || hover === key ? c('card2') : 'none'};stroke:${c('line2')}"/>` +
      `<text x="${x + w / 2}" y="${y + 24}" text-anchor="middle" ${SANS} font-size="14.5" font-weight="500" style="fill:${c('ink')}">${esc(label)}</text>`
    x += w + 8
  }
  const height = y + 40
  return { svg: panel(width, height, body), height, parts }
}

export const ROW_H = 44

export type RowMark = { text: string; tone: PillTone } | { time: string }

/** One message row: badge, who, what, and a pill or the time at the right. */
export function row(x0: number, width: number, top: number, item: InboxItem, mark: RowMark, hover: string, isDim: boolean): string {
  const key = `inbox:open:${item.id}`
  const cy = top + ROW_H / 2
  const badge = sourceBadge(x0 + 6, cy, item.source)
  const { who, what } = rowText(item)
  const right = x0 + width - 8
  const markSvg = 'time' in mark
    ? `<text x="${right}" y="${cy + 5}" text-anchor="end" ${SANS} font-size="14" style="fill:${c('faint')}">${esc(mark.time)}</text>`
    : pill(right, cy, mark.text, mark.tone)
  const markW = 'time' in mark ? textWidth(mark.time, 14) : textWidth(mark.text, 13.5, true) + 22
  const whoX = x0 + 6 + badge.width + 12
  const whoText = fit(who, Math.min(200, width * 0.36), 15.5, true)
  const whoW = textWidth(whoText, 15.5, true)
  const whatX = whoX + whoW + 12
  const whatText = fit(what, Math.max(0, right - markW - 14 - whatX), 14)
  return (hover === key ? `<rect x="${x0}" y="${top + 2}" width="${width}" height="${ROW_H - 4}" rx="10" style="fill:${c('card2')}"/>` : '') +
    `<g${isDim ? ' opacity=".62"' : ''}>${badge.svg}` +
    `<text x="${whoX}" y="${cy + 5.5}" ${SANS} font-size="15.5" font-weight="600" style="fill:${c('ink')}">${esc(whoText)}</text>` +
    `<text x="${whatX}" y="${cy + 5}" ${SANS} font-size="14" style="fill:${c('muted')}">${esc(whatText)}</text></g>` + markSvg
}

