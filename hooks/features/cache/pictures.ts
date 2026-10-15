// Cache Tax's card above the prompt (screen F7): "Your message is on hold", the two prices in a well,
// what is held and the keep-warm offer, then Pay and send, Start fresh and Show cache status. A band
// too low for it gets the compact card with the buttons inside. Plain TypeScript, no engine.

import { SANS, SVG_STYLE, c, esc, eyebrow, fit, icon, textWidth } from '../../ui/theme.ts'
import type { Part } from '../../ui/kit.ts'
import { fmtDuration, fmtRate, fmtUsd, type CacheHeld } from './model.ts'

/** A picture on the band's own gray. */
const bandPicture = (width: number, height: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${SVG_STYLE}` +
  `<rect width="${width}" height="${height}" style="fill:${c('band')}"/>${body}</svg>`

/** The cache-tax mark: a box with a clay lid and a prompt arrow, `size` px square. */
function mark(x: number, y: number, size: number): string {
  const k = size / 56
  const p = (d: string) => d.replace(/(\d+(?:\.\d+)?)/g, n => String(+(Number(n) * k).toFixed(2)))
  return `<g transform="translate(${x},${y})">` +
    `<path d="${p('M28 4l22 11v26L28 52 6 41V15z')}" style="fill:none;stroke:${c('ink')}" stroke-width="${(4 * k).toFixed(2)}" stroke-linejoin="round"/>` +
    `<path d="${p('M6 15l22 11 22-11')}" style="fill:none;stroke:${c('ink')}" stroke-width="${(4 * k).toFixed(2)}" stroke-linejoin="round"/>` +
    `<path d="${p('M28 4l22 11-22 11L6 15z')}" style="fill:${c('orange')}"/>` +
    `<path d="${p('M28 26v26')}" style="stroke:${c('ink')}" stroke-width="${(4 * k).toFixed(2)}"/>` +
    `<path d="${p('M35 33l6 4-6 4')}" style="fill:none;stroke:${c('ink')}" stroke-width="${(3.5 * k).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/></g>`
}

/** The warm turn's share of the cold one, for its bar (at least a sliver). */
const warmShare = (held: CacheHeld) =>
  held.coldUsd && held.warmUsd !== null ? Math.min(1, Math.max(0.03, held.warmUsd / held.coldUsd)) : 0.06

const quoted = (text: string) => `“${text.replace(/\s+/g, ' ').trim()}”`

const sendNote = (held: CacheHeld) =>
  `re-writes up to ${held.tokens.toLocaleString('en-US')} tokens${held.writeRate !== null ? ` at ${fmtRate(held.writeRate)}` : ''}`

/** The card: mark, eyebrow and title, the two prices, what is held, the keep-warm offer. */
export function cardSvg(width: number, held: CacheHeld): { svg: string; height: number; parts: Part[] } {
  const pad = 20
  const inner = width - pad * 2
  let y = pad
  let body = mark(pad, y, 46) +
    eyebrow('Cache tax', pad + 64, y + 13, c('orange'), 12.5) +
    `<text x="${pad + 64}" y="${y + 38}" ${SANS} font-size="20" font-weight="600" style="fill:${c('ink')}">Your message is on hold</text>` +
    `<text x="${pad + 64}" y="${y + 60}" ${SANS} font-size="15" style="fill:${c('muted')}">${esc(`The prompt cache went cold ${fmtDuration(held.coldForMs)} ago.`)}</text>`
  y += 76

  // The well: Send it now and A warm turn, side by side (one under the other when narrow).
  const isSide = inner >= 460
  const colW = isSide ? (inner - 40 - 24) / 2 : inner - 40
  const wellH = isSide ? 112 : 112 * 2 + 8
  body += `<rect x="${pad}" y="${y}" width="${inner}" height="${wellH}" rx="12" style="fill:${c('well')}"/>`
  const price = (x: number, top: number, label: string, usd: string, color: string, share: number, note: string) => {
    body += `<text x="${x}" y="${top + 26}" ${SANS} font-size="14" font-weight="600" style="fill:${c('muted')}">${label}</text>` +
      `<text x="${x}" y="${top + 58}" ${SANS} font-size="26" font-weight="700" style="fill:${color}">${esc(usd)}</text>` +
      `<rect x="${x}" y="${top + 70}" width="${colW}" height="8" rx="4" style="fill:${c('track')}"/>` +
      `<rect x="${x}" y="${top + 70}" width="${Math.max(8, colW * share)}" height="8" rx="4" style="fill:${color}"/>` +
      `<text x="${x}" y="${top + 98}" ${SANS} font-size="13.5" style="fill:${c('muted')}">${esc(fit(note, colW, 13.5))}</text>`
  }
  price(pad + 20, y, 'Send it now', fmtUsd(held.coldUsd), c('orange'), 1, sendNote(held))
  if (isSide) price(pad + 20 + colW + 24, y, 'A warm turn', fmtUsd(held.warmUsd), c('green'), warmShare(held), 'what it would have cost')
  else price(pad + 20, y + 112, 'A warm turn', fmtUsd(held.warmUsd), c('green'), warmShare(held), 'what it would have cost')
  y += wellH + 18

  // What is held, and what paying does.
  const lead = 'On hold: '
  body += icon('pause', pad, y, 20, c('muted')) +
    `<text x="${pad + 32}" y="${y + 15}" ${SANS} font-size="15" xml:space="preserve"><tspan style="fill:${c('muted')}">${lead}</tspan>` +
    `<tspan style="fill:${c('ink')}">${esc(fit(quoted(held.text), inner - 32 - textWidth(lead, 15), 15))}</tspan></text>`
  y += 30
  body += icon('shieldCheck', pad, y, 20, c('green')) +
    `<text x="${pad + 32}" y="${y + 15}" ${SANS} font-size="15" style="fill:${c('ink')}">${esc(fit('Pay once to send it. /sb-cache warm keeps it warm after, if you want.', inner - 32, 15))}</text>`
  y += 20 + pad
  const height = y
  const frame = `<rect x="0.75" y="0.75" width="${width - 1.5}" height="${height - 1.5}" rx="20" style="fill:${c('surface')};stroke:${c('frame')}" stroke-width="1.5"/>`
  return { svg: bandPicture(width, height, frame + body), height, parts: [] }
}

type Look = 'primary' | 'outline' | 'text'
const BUTTONS: [string, string, Look][] = [
  ['cache:pay', 'Pay and send', 'primary'],
  ['cache:fresh', 'Start fresh', 'outline'],
  ['cache:status', 'Show cache status', 'text'],
]

function buttons(x0: number, right: number, top: number, h: number, size: number, padX: number, hover: string): { body: string; parts: Part[]; bottom: number } {
  const parts: Part[] = []
  let body = ''
  let x = x0
  let y = top
  for (const [key, label, look] of BUTTONS) {
    const w = Math.round(textWidth(label, size, true) * 0.92) + (look === 'text' ? padX - 10 : padX)
    if (x > x0 && x + w > right) {
      x = x0
      y += h + 8
    }
    parts.push({ key, leftPx: x, widthPx: w, topPx: y, heightPx: h })
    const isHover = hover === key
    const fill = look === 'primary' ? c('prim') : isHover ? c('card2') : 'none'
    const stroke = look === 'primary' ? c('prim') : look === 'outline' ? c('line2') : 'none'
    body += `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" rx="${h > 40 ? 11 : 10}" style="fill:${fill};stroke:${stroke}"/>` +
      (look === 'primary' && isHover ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h > 40 ? 11 : 10}" fill="#FFFFFF" fill-opacity=".14"/>` : '') +
      `<text x="${x + w / 2}" y="${y + h / 2 + size / 3}" text-anchor="middle" ${SANS} font-size="${size}" font-weight="600" ` +
      `style="fill:${look === 'primary' ? c('onprim') : look === 'text' ? c('muted') : c('ink')}">${esc(label)}</text>`
    x += w + 10
  }
  return { body, parts, bottom: y + h }
}

/** Pay and send (clay), Start fresh, Show cache status, under the card. */
export function buttonsSvg(width: number, hover: string): { svg: string; height: number; parts: Part[] } {
  const row = buttons(0, width, 4, 46, 15, 30, hover)
  const height = row.bottom + 4
  return { svg: bandPicture(width, height, row.body), height, parts: row.parts }
}

/** The whole card in one short picture, buttons inside, for a band too low for the full card. */
export function compactSvg(width: number, held: CacheHeld, hover: string): { svg: string; height: number; parts: Part[] } {
  const pad = 12
  const x0 = pad + 32 + 14
  const cw = width - pad - x0
  let y = pad
  const cold = `cold ${fmtDuration(held.coldForMs)}`
  let body = mark(pad, y, 32) +
    eyebrow('Cache tax', x0, y + 13, c('orange'), 12) +
    `<text x="${width - pad - 4}" y="${y + 13}" text-anchor="end" ${SANS} font-size="13.5" style="fill:${c('muted')}">${esc(cold)}</text>` +
    `<text x="${x0}" y="${y + 36}" ${SANS} font-size="17" font-weight="600" style="fill:${c('ink')}">Your message is on hold</text>`
  y += 46
  const lead = 'On hold: '
  body += `<text x="${x0}" y="${y + 13}" ${SANS} font-size="13.5" xml:space="preserve"><tspan style="fill:${c('muted')}">${lead}</tspan>` +
    `<tspan style="fill:${c('ink')}">${esc(fit(quoted(held.text), cw - textWidth(lead, 13.5) - 4, 13.5))}</tspan></text>`
  y += 24

  // The two prices as small wells, side by side when each gets 200 px.
  const isSide = (cw - 8) / 2 >= 200
  const w = isSide ? (cw - 8) / 2 : cw
  const well = (x: number, top: number, label: string, usd: string, color: string, share: number) => {
    body += `<rect x="${x}" y="${top}" width="${w}" height="42" rx="10" style="fill:${c('well')}"/>` +
      `<text x="${x + 12}" y="${top + 19}" ${SANS} font-size="13" font-weight="600" style="fill:${c('muted')}">${label}</text>` +
      `<text x="${x + w - 12}" y="${top + 21}" text-anchor="end" ${SANS} font-size="17" font-weight="700" style="fill:${color}">${esc(usd)}</text>` +
      `<rect x="${x + 12}" y="${top + 29}" width="${w - 24}" height="5" rx="2.5" style="fill:${c('track')}"/>` +
      `<rect x="${x + 12}" y="${top + 29}" width="${Math.max(5, (w - 24) * share)}" height="5" rx="2.5" style="fill:${color}"/>`
  }
  well(x0, y, 'Send it now', fmtUsd(held.coldUsd), c('orange'), 1)
  well(isSide ? x0 + w + 8 : x0, isSide ? y : y + 48, 'A warm turn', fmtUsd(held.warmUsd), c('green'), warmShare(held))
  y += (isSide ? 42 : 90) + 10

  const row = buttons(x0, width - pad, y, 36, 14, 26, hover)
  body += row.body
  const height = row.bottom + pad
  const frame = `<rect x="0.75" y="0.75" width="${width - 1.5}" height="${height - 1.5}" rx="16" style="fill:${c('surface')};stroke:${c('frame')}" stroke-width="1.5"/>`
  return { svg: bandPicture(width, height, frame + body), height, parts: row.parts }
}
