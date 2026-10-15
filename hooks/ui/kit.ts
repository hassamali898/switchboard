// Picture pieces every feature's pane shares: the serif pane title, section labels, pills, file
// badges and a wrapping row of outlined buttons with their hover. Plain SVG strings from the theme
// tokens; the parts that act come back with their positions, for `clickable()`.

import { MONO, SANS, SERIF, c, esc, fit, svgOpen, textWidth, type TokenName } from './theme.ts'
import type { Hit } from './click.tsx'

/** A part of a picture that acts, without its action yet (the view adds `onPress`). */
export type Part = Omit<Hit, 'onPress'>

/** A full-width picture that paints the pane's own background first. */
export const panel = (width: number, height: number, body: string) =>
  svgOpen(width, height) + `<rect width="${width}" height="${height}" style="fill:${c('pane')}"/>` + body + '</svg>'

/** The pane's title, in the design's serif ("Files: weather-app"). */
export const titleSvg = (width: number, text: string) =>
  panel(width, 40, `<text x="2" y="27" ${SERIF} font-size="20" style="fill:${c('ink')}">${fit(text, width - 4, 20)}</text>`)

/** An all-caps section label, with an optional label at the right ("ALL FILES" … "WEATHER-APP"). */
export function sectionSvg(width: number, left: string, right = ''): string {
  const label = (x: number, text: string, anchor: 'start' | 'end') =>
    `<text x="${x}" y="18" text-anchor="${anchor}" ${SANS} font-size="12.5" font-weight="700" letter-spacing="1.1" ` +
    `style="fill:${c('muted')}">${esc(text.toUpperCase())}</text>`
  return panel(width, 26, label(2, left, 'start') + (right ? label(width - 2, right, 'end') : ''))
}

/** A card's rounded background at full width. */
export const cardRect = (width: number, height: number) =>
  `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="16" style="fill:${c('card')};stroke:${c('line')}"/>`

export type PillTone = 'teal' | 'orange' | 'green' | 'amber' | 'red' | 'muted'

const PILL_COLORS: Record<PillTone, { fg: TokenName; bg: TokenName }> = {
  teal: { fg: 'teal', bg: 'tealSoft' }, orange: { fg: 'orange', bg: 'orangeSoft' }, green: { fg: 'green', bg: 'greenSoft' },
  amber: { fg: 'amber', bg: 'amberSoft' }, red: { fg: 'red', bg: 'redSoft' }, muted: { fg: 'muted', bg: 'card2' },
}

export const pillWidth = (text: string, size = 13.5) => textWidth(text, size, true) + 22

/** A rounded pill ending at `right`, centred on `cy`. Returns the SVG. */
export function pill(right: number, cy: number, text: string, tone: PillTone, size = 13.5): string {
  const width = pillWidth(text, size)
  const height = size * 1.9
  const { fg, bg } = PILL_COLORS[tone]
  return `<rect x="${right - width}" y="${cy - height / 2}" width="${width}" height="${height}" rx="${height / 2}" style="fill:${c(bg)}"/>` +
    `<text x="${right - width / 2}" y="${cy + size * 0.36}" text-anchor="middle" ${SANS} font-size="${size}" font-weight="600" ` +
    `style="fill:${c(fg)}">${esc(text)}</text>`
}

type BadgeStyle = { label: string; fg: TokenName; bg: TokenName }

const BADGES: Record<string, BadgeStyle> = {
  js: { label: 'JS', fg: 'js', bg: 'jsBg' }, jsx: { label: 'JSX', fg: 'js', bg: 'jsBg' }, mjs: { label: 'JS', fg: 'js', bg: 'jsBg' },
  cjs: { label: 'JS', fg: 'js', bg: 'jsBg' }, ts: { label: 'TS', fg: 'blue', bg: 'blueSoft' }, tsx: { label: 'TSX', fg: 'blue', bg: 'blueSoft' },
  json: { label: '{ }', fg: 'green', bg: 'greenSoft' }, md: { label: 'MD', fg: 'muted', bg: 'card2' }, py: { label: 'PY', fg: 'blue', bg: 'blueSoft' },
  css: { label: 'CSS', fg: 'pink', bg: 'pinkSoft' }, scss: { label: 'CSS', fg: 'pink', bg: 'pinkSoft' }, html: { label: 'HTML', fg: 'orange', bg: 'orangeSoft' },
  yml: { label: 'YML', fg: 'teal', bg: 'tealSoft' }, yaml: { label: 'YML', fg: 'teal', bg: 'tealSoft' }, toml: { label: 'TOML', fg: 'teal', bg: 'tealSoft' },
  sh: { label: 'SH', fg: 'green', bg: 'greenSoft' }, go: { label: 'GO', fg: 'blue', bg: 'blueSoft' }, rs: { label: 'RS', fg: 'orange', bg: 'orangeSoft' },
  svg: { label: 'SVG', fg: 'pink', bg: 'pinkSoft' }, png: { label: 'IMG', fg: 'pink', bg: 'pinkSoft' }, jpg: { label: 'IMG', fg: 'pink', bg: 'pinkSoft' },
  lock: { label: 'LCK', fg: 'muted', bg: 'card2' },
}

/** The small monospace badge before a file name (JS, TS, { }, GIT, ...). */
export function badgeOf(name: string): BadgeStyle {
  if (/^\.git(ignore|attributes|modules)$/.test(name)) return { label: 'GIT', fg: 'muted', bg: 'card2' }
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
  return BADGES[ext] ?? { label: ext ? ext.slice(0, 3).toUpperCase() : '·', fg: 'muted', bg: 'card2' }
}

/** Draws a badge at `x`, centred on `cy`; returns the SVG and how wide it was. */
export function badge(x: number, cy: number, name: string): { svg: string; width: number } {
  const style = badgeOf(name)
  const width = Math.max(26, style.label.length * 7 + 12)
  return {
    width,
    svg: `<rect x="${x}" y="${cy - 10.5}" width="${width}" height="21" rx="6" style="fill:${c(style.bg)}"/>` +
      `<text x="${x + width / 2}" y="${cy + 4}" text-anchor="middle" ${MONO} font-size="11" font-weight="700" ` +
      `style="fill:${c(style.fg)}">${esc(style.label)}</text>`,
  }
}

export type RowButton = { key: string; label: string; isPrimary?: boolean }

const BUTTON_H = 38
const BUTTON_GAP = 8

/**
 * Outlined buttons that wrap to the width, as the design's toolbars. Hover fills the button. `pad` is
 * each button's room around its label.
 */
export function buttonRow(width: number, buttons: readonly RowButton[], hover: string, pad = 30): { svg: string; height: number; parts: Part[] } {
  const parts: Part[] = []
  let x = 0
  let y = 0
  for (const button of buttons) {
    const w = Math.ceil(textWidth(button.label, 14.5, true)) + pad
    if (x > 0 && x + w > width) {
      x = 0
      y += BUTTON_H + BUTTON_GAP
    }
    parts.push({ key: button.key, leftPx: x, widthPx: w, topPx: y, heightPx: BUTTON_H })
    x += w + BUTTON_GAP
  }
  const height = y + BUTTON_H + 2
  const body = parts.map((part, index) => {
    const button = buttons[index]!
    const isHover = hover === part.key
    const fill = button.isPrimary ? c('prim') : isHover ? c('card2') : 'none'
    const stroke = button.isPrimary ? c('prim') : c('line2')
    return `<rect x="${part.leftPx + 0.5}" y="${part.topPx + 0.5}" width="${part.widthPx - 1}" height="${BUTTON_H - 1}" rx="11" ` +
      `style="fill:${fill};stroke:${stroke}"/>` +
      (button.isPrimary && isHover ? `<rect x="${part.leftPx}" y="${part.topPx}" width="${part.widthPx}" height="${BUTTON_H}" rx="11" fill="#FFFFFF" fill-opacity=".14"/>` : '') +
      `<text x="${part.leftPx + part.widthPx / 2}" y="${part.topPx + 24}" text-anchor="middle" ${SANS} font-size="14.5" font-weight="500" ` +
      `style="fill:${c(button.isPrimary ? 'onprim' : 'ink')}">${esc(button.label)}</text>`
  }).join('')
  return { svg: panel(width, height, body), height, parts }
}
