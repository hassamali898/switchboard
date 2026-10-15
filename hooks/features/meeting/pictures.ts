// The meeting card (screen 6): a countdown ring, "Meeting · starts in 4 min", the title, the time and
// where it is, the people coming, then Join now, Remind me in 1 min, In 3 min, Not going. A band too low
// for it gets the compact card with the buttons inside. Plain TypeScript, no engine.

import { SANS, SERIF, SVG_STYLE, c, esc, eyebrow, fit, textWidth } from '../../ui/theme.ts'
import type { Part } from '../../ui/kit.ts'
import { joinable, type Meeting } from './model.ts'

const bandPicture = (width: number, height: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${SVG_STYLE}` +
  `<rect width="${width}" height="${height}" style="fill:${c('band')}"/>${body}</svg>`

const frame = (width: number, height: number, radius: number) =>
  `<rect x="0.75" y="0.75" width="${width - 1.5}" height="${height - 1.5}" rx="${radius}" style="fill:${c('surface')};stroke:${c('frame')}" stroke-width="1.5"/>`

const AVATAR_COLORS = ['#788C5D', '#6A9BCC', '#C46686', '#D97757', '#5FB3A8', '#B08A3E']

const initials = (name: string) => {
  const words = name.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean)
  return ((words[0]?.[0] ?? '?') + (words[1]?.[0] ?? '')).toUpperCase()
}

const colorOf = (name: string) => AVATAR_COLORS[[...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % AVATAR_COLORS.length]!

/** "4:12" left, "0:00" at the start. */
export function clockText(meeting: Meeting, now: number): string {
  const seconds = Math.max(0, Math.round((meeting.startsAt - now) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** "starts in 4 min", "starting now", "started 2 min ago". */
export function whenText(meeting: Meeting, now: number): string {
  const left = meeting.startsAt - now
  if (left >= 60_000) return `starts in ${Math.floor(left / 60_000)} min`
  if (left > 0) return 'starts in under a minute'
  if (now - meeting.startsAt < 60_000) return 'starting now'
  return `started ${Math.floor((now - meeting.startsAt) / 60_000)} min ago`
}

const hhmm = (ms: number) => {
  const date = new Date(ms)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** "Google Meet", "Zoom", "Teams", or the host. */
export function placeOf(url: string): string {
  if (/meet\.google\.com/.test(url)) return 'Google Meet'
  if (/zoom\.us/.test(url)) return 'Zoom'
  if (/teams\.microsoft|teams\.live/.test(url)) return 'Teams'
  return url.replace(/^https:\/\//, '').split('/')[0] ?? ''
}

/** "11:30 – 12:00 · Google Meet · meet.google.com/abc-defg-hij". */
export const detailText = (meeting: Meeting) =>
  [`${hhmm(meeting.startsAt)} – ${hhmm(meeting.endsAt)}`, ...(joinable(meeting.joinUrl) ? [placeOf(meeting.joinUrl), meeting.joinUrl.replace(/^https:\/\//, '')] : [])].join(' · ')

/** The countdown ring at (x, y), `size` px: the arc is the share of the lead time left. */
function ring(x: number, y: number, size: number, meeting: Meeting, now: number, leadMs: number): string {
  const r = size / 2 - size * 0.06
  const cx = x + size / 2
  const cy = y + size / 2
  const length = 2 * Math.PI * r
  const left = Math.max(0, Math.min(1, (meeting.startsAt - now) / leadMs))
  const stroke = (size * 0.06).toFixed(1)
  return `<circle cx="${cx}" cy="${cy}" r="${r}" style="fill:none;stroke:${c('track')}" stroke-width="${stroke}"/>` +
    (left > 0 ? `<circle cx="${cx}" cy="${cy}" r="${r}" style="fill:none;stroke:${c('red')}" stroke-width="${stroke}" stroke-linecap="round" ` +
      `stroke-dasharray="${(length * left).toFixed(1)} ${length.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>` : '') +
    `<text x="${cx}" y="${cy + size * 0.07}" text-anchor="middle" ${SANS} font-size="${(size * 0.23).toFixed(1)}" font-weight="600" style="fill:${c('ink')}">${clockText(meeting, now)}</text>`
}

/** Overlapping initials circles for the first four people, then "+3". */
function people(x: number, cy: number, names: readonly string[], size: number, background: string): { body: string; width: number } {
  const shown = names.slice(0, 4)
  const overlap = Math.round(size * 0.18)
  let body = ''
  shown.forEach((name, index) => {
    const cx = x + size / 2 + index * (size - overlap)
    body += `<circle cx="${cx}" cy="${cy}" r="${size / 2}" style="fill:${colorOf(name)};stroke:${background}" stroke-width="2"/>` +
      `<text x="${cx}" y="${cy + size * 0.13}" text-anchor="middle" ${SANS} font-size="${(size * 0.36).toFixed(1)}" font-weight="700" fill="#FFFFFF">${esc(initials(name))}</text>`
  })
  const width = shown.length ? size + (shown.length - 1) * (size - overlap) : 0
  const more = names.length - shown.length
  if (more > 0) body += `<text x="${x + width + 10}" y="${cy + 5}" ${SANS} font-size="14.5" style="fill:${c('muted')}">+${more}</text>`
  return { body, width: width + (more > 0 ? 10 + textWidth(`+${more}`, 14.5) : 0) }
}

type Look = 'primary' | 'outline' | 'text'

function buttons(meetings: readonly Meeting[], x0: number, right: number, top: number, hover: string, h: number, size: number):
  { body: string; parts: Part[]; bottom: number } {
  const list: [string, string, Look][] = []
  for (const meeting of meetings) {
    if (joinable(meeting.joinUrl)) list.push([`meeting:join:${meeting.id}`, meetings.length > 1 ? `Join ${fit(meeting.title, 120, size, true)}` : 'Join now', 'primary'])
  }
  list.push(['meeting:later:1', 'Remind me in 1 min', 'outline'], ['meeting:later:3', 'In 3 min', 'outline'], ['meeting:dismiss', 'Not going', 'text'])
  const parts: Part[] = []
  let body = ''
  let x = x0
  let y = top
  for (const [key, label, look] of list) {
    const iconW = look === 'primary' ? 24 : 0
    const w = Math.round(textWidth(label, size, true) * 0.92) + (look === 'text' ? 18 : 30) + iconW
    if (x > x0 && x + w > right) {
      x = x0
      y += h + 8
    }
    parts.push({ key, leftPx: x, widthPx: w, topPx: y, heightPx: h })
    const isHover = hover === key
    const fill = look === 'primary' ? c('prim') : isHover ? c('card2') : 'none'
    const stroke = look === 'primary' ? c('prim') : look === 'outline' ? c('line2') : 'none'
    const color = look === 'primary' ? c('onprim') : look === 'text' ? c('muted') : c('ink')
    body += `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" rx="11" style="fill:${fill};stroke:${stroke}"/>` +
      (look === 'primary' && isHover ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="11" fill="#FFFFFF" fill-opacity=".14"/>` : '') +
      (iconW ? `<g transform="translate(${x + 14},${y + h / 2 - 9}) scale(0.75)"><path d="M3 7h12v10H3zM15 10l6-3v10l-6-3" fill="none" style="stroke:${color}" stroke-width="2" stroke-linejoin="round"/></g>` : '') +
      `<text x="${x + (w + iconW) / 2}" y="${y + h / 2 + size / 3}" text-anchor="middle" ${SANS} font-size="${size}" font-weight="600" style="fill:${color}">${esc(label)}</text>`
    x += w + 10
  }
  return { body, parts, bottom: y + h }
}

/** The card: ring, eyebrow, title, time and place, people. */
export function cardSvg(width: number, meetings: readonly Meeting[], now: number, leadMs: number): { svg: string; height: number } {
  const first = meetings[0]!
  const pad = 20
  const x0 = pad + 132 + 24
  const textW = width - x0 - pad
  const title = meetings.length > 1 ? meetings.map(one => one.title).join(' · ') : first.title
  let body = ring(pad, pad, 132, first, now, leadMs) +
    eyebrow(`Meeting · ${whenText(first, now)}`, x0, pad + 26, c('red'), 12.5) +
    `<text x="${x0}" y="${pad + 60}" ${SERIF} font-size="24" font-weight="500" style="fill:${c('ink')}">${esc(fit(title, textW, 24))}</text>` +
    `<text x="${x0}" y="${pad + 88}" ${SANS} font-size="15" style="fill:${c('muted')}">${esc(fit(detailText(first), textW, 15))}</text>`
  const crowd = people(x0, pad + 118, first.attendees, 32, c('surface'))
  body += crowd.body
  const height = pad + 132 + pad
  return { svg: bandPicture(width, height, frame(width, height, 20) + body), height }
}

/** Join now, Remind me in 1 min, In 3 min, Not going. */
export function buttonsSvg(width: number, meetings: readonly Meeting[], hover: string): { svg: string; height: number; parts: Part[] } {
  const row = buttons(meetings, 0, width, 4, hover, 46, 15)
  const height = row.bottom + 4
  return { svg: bandPicture(width, height, row.body), height, parts: row.parts }
}

/** The whole card in one short picture, buttons inside, for a band too low for the full card. */
export function compactSvg(width: number, meetings: readonly Meeting[], now: number, leadMs: number, hover: string): { svg: string; height: number; parts: Part[] } {
  const first = meetings[0]!
  const pad = 14
  const x0 = pad + 76 + 16
  const textW = width - x0 - pad
  const title = meetings.length > 1 ? meetings.map(one => one.title).join(' · ') : first.title
  let body = ring(pad, pad, 76, first, now, leadMs) +
    eyebrow(`Meeting · ${whenText(first, now)}`, x0, pad + 14, c('red'), 12) +
    `<text x="${x0}" y="${pad + 40}" ${SERIF} font-size="19" font-weight="500" style="fill:${c('ink')}">${esc(fit(title, textW, 19))}</text>`
  const crowd = people(x0, pad + 62, first.attendees, 24, c('surface'))
  body += crowd.body +
    `<text x="${x0 + crowd.width + (crowd.width ? 14 : 0)}" y="${pad + 67}" ${SANS} font-size="13.5" style="fill:${c('muted')}">` +
    `${esc(fit(detailText(first), textW - crowd.width - 14, 13.5))}</text>`
  const row = buttons(meetings, x0, width - pad, pad + 84, hover, 36, 14)
  body += row.body
  const height = Math.max(pad + 76, row.bottom) + pad
  return { svg: bandPicture(width, height, frame(width, height, 16) + body), height, parts: row.parts }
}
