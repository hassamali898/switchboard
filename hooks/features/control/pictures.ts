// The Switchboard pane's data and its desktop pictures (screen 2). Plain TypeScript with no JSX and no
// engine, so the same pictures render in tests and in the design preview (scripts/preview.ts).

import { FEATURES, isAvailable, type FeatureId, type Tone } from '../../core/features.ts'
import type { Settings } from '../../core/store.ts'
import { MONO, SANS, SERIF, c, esc, eyebrow, fit, icon, svgOpen, textWidth, type TokenName } from '../../ui/theme.ts'

export type ControlRow = {
  id: FeatureId
  name: string
  command: string
  description: string
  tone: Tone
  isOn: boolean
  isAvailable: boolean
  status: string
}

export type ControlModel = {
  onCount: number
  total: number
  headline: string
  sub: string
  rows: ControlRow[]
}


const ICON_FOR: Record<FeatureId, string> = {
  inbox: 'bell', agents: 'agents', files: 'folder', replay: 'play', blast: 'trash', reflect: 'bookmark',
  cache: 'cube', browser: 'globe',
}

/** What each row says, from the settings and what the features report. */
export function controlModel(settings: Settings, surfaces: readonly string[],
                             statuses: Partial<Record<FeatureId, string>>, sub?: string): ControlModel {
  const rows = FEATURES.map(feature => {
    const available = isAvailable(feature, surfaces)
    const isOn = available && settings.features[feature.id]
    const status = !available ? 'terminal only'
      : !isOn ? 'off'
      : statuses[feature.id] ?? `phase ${feature.phase}`
    return { id: feature.id, name: feature.name, command: feature.command, description: feature.description,
      tone: feature.tone, isOn, isAvailable: available, status }
  })
  const onCount = rows.filter(row => row.isOn).length
  const headline = onCount === rows.length ? 'All features are on'
    : onCount === 0 ? 'Every feature is off' : `${onCount} of ${rows.length} features are on`
  return { onCount, total: rows.length, headline, sub: sub ?? 'Nothing needs you right now', rows }
}

const toneColor = (tone: Tone): { fg: TokenName; bg: TokenName } =>
  tone === 'faint' ? { fg: 'faint', bg: 'card2' } : { fg: tone, bg: `${tone}Soft` as TokenName }


export const ROW_H = 62
export const LIST_PAD = 12

export function headerSvg(width: number, model: ControlModel): string {
  const height = 98
  return svgOpen(width, height) +
    `<rect width="${width}" height="${height}" style="fill:${c('pane')}"/>` +
    `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="16" style="fill:${c('card')};stroke:${c('line')}"/>` +
    `<rect x="20" y="22" width="54" height="54" rx="14" style="fill:${c('orangeSoft')}"/>` +
    icon('sliders', 35, 37, 24, c('orange')) +
    eyebrow('Right now', 92, 36, c('orange')) +
    `<text x="92" y="62" ${SERIF} font-size="20" font-weight="500" style="fill:${c('ink')}">${fit(model.headline, width - 112, 20)}</text>` +
    `<text x="92" y="83" ${SANS} font-size="15" style="fill:${c('muted')}">${fit(model.sub, width - 112, 15)}</text></svg>`
}

export function titleSvg(width: number): string {
  return svgOpen(width, 40) + `<rect width="${width}" height="40" style="fill:${c('pane')}"/>` +
    `<text x="2" y="27" ${SERIF} font-size="20" style="fill:${c('ink')}">Switchboard</text></svg>`
}

export function sectionSvg(width: number, label: string): string {
  return svgOpen(width, 26) + `<rect width="${width}" height="26" style="fill:${c('pane')}"/>` +
    `<text x="2" y="18" ${SANS} font-size="12.5" font-weight="700" letter-spacing="1.1" style="fill:${c('muted')}">${esc(label)}</text></svg>`
}

export const TOGGLE_W = 42

function toggle(x: number, y: number, isOn: boolean, isAvailable: boolean, isHover = false): string {
  // Hover: a soft clay ring, the design's focus color, drawn by the picture itself.
  const ring = isHover ? `<rect x="${x - 3}" y="${y - 3}" width="${TOGGLE_W + 6}" height="30" rx="15" ` +
    `style="fill:none;stroke:${c('focus')};stroke-opacity:.45" stroke-width="2"/>` : ''
  const knobX = isOn ? x + TOGGLE_W - 21 : x + 3
  return ring + `<g opacity="${isAvailable ? 1 : 0.35}"><rect x="${x}" y="${y}" width="${TOGGLE_W}" height="24" rx="12" ` +
    `style="fill:${c(isOn ? 'orange' : 'off')}"/><circle cx="${knobX + 9}" cy="${y + 12}" r="9" fill="#FFFFFF"/></g>`
}

/** `hover`: the key of the part under the pointer (`toggle:<feature>`), or ''. */
export function listSvg(width: number, rows: ControlRow[], hover = ''): string {
  const height = LIST_PAD * 2 + rows.length * ROW_H
  const toggleX = width - 20 - TOGGLE_W
  let body = ''
  rows.forEach((row, index) => {
    const top = LIST_PAD + index * ROW_H
    const { fg, bg } = toneColor(row.tone)
    const nameColor = row.isAvailable ? c('ink') : c('muted')
    const nameW = textWidth(row.name, 16, true)
    const cmdW = row.command.length * 12.5 * 0.6 + 14 // monospace: about 0.6 em a character
    const statusW = Math.min(150, textWidth(row.status, 13) + 4)
    const textMax = toggleX - 14 - statusW - 12 - 72
    if (index > 0) body += `<line x1="20" x2="${width - 20}" y1="${top}" y2="${top}" style="stroke:${c('line')}"/>`
    body +=
      `<rect x="20" y="${top + 12}" width="38" height="38" rx="12" style="fill:${c(bg)}"/>` +
      icon(ICON_FOR[row.id], 29, top + 21, 20, c(fg)) +
      `<text x="72" y="${top + 28}" ${SANS} font-size="16" font-weight="600" style="fill:${nameColor}">${esc(row.name)}</text>` +
      (nameW + 8 + cmdW < textMax
        ? `<g opacity="${row.isAvailable ? 1 : 0.6}"><rect x="${72 + nameW + 8}" y="${top + 14}" width="${cmdW}" height="19" rx="6" ` +
          `style="fill:${c('orangeSoft')}"/><text x="${72 + nameW + 15}" y="${top + 27.5}" ${MONO} font-size="12.5" ` +
          `font-weight="500" style="fill:${c('orange')}">${esc(row.command)}</text></g>` : '') +
      `<text x="72" y="${top + 48}" ${SANS} font-size="13.5" style="fill:${c('muted')}">${fit(row.description, textMax, 13.5)}</text>` +
      `<text x="${toggleX - 14}" y="${top + 36}" text-anchor="end" ${SANS} font-size="13" style="fill:${c('muted')}">` +
      `${fit(row.status, statusW, 13)}</text>` +
      toggle(toggleX, top + 19, row.isOn, row.isAvailable, hover === `toggle:${row.id}`)
  })
  return svgOpen(width, height) + `<rect width="${width}" height="${height}" style="fill:${c('pane')}"/>` +
    `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="16" style="fill:${c('card')};stroke:${c('line')}"/>` +
    body + '</svg>'
}

export const FOOTER_H = 50
const BUTTON_H = 42

/** Where each footer button sits, so the blank Buttons under the picture line up with it. */
export function footerLayout(): { openInbox: { x: number; w: number }; sources: { x: number; w: number } } {
  const openW = Math.ceil(textWidth('Open Inbox', 15.5, true)) + 40
  const sourcesW = Math.ceil(textWidth('Inbox sources', 15.5, true)) + 40
  return { openInbox: { x: 0, w: openW }, sources: { x: openW + 12, w: sourcesW } }
}

/** The footer as the design draws it: a clay primary button, an outlined one, and a quiet note. */
export function footerSvg(width: number, hover = ''): string {
  const { openInbox, sources } = footerLayout()
  const top = (FOOTER_H - BUTTON_H) / 2
  const label = (x: number, w: number, text: string, color: string) =>
    `<text x="${x + w / 2}" y="${top + 26.5}" text-anchor="middle" ${SANS} font-size="15.5" font-weight="500" ` +
    `style="fill:${color}">${esc(text)}</text>`
  const noteX = sources.x + sources.w + 16
  return svgOpen(width, FOOTER_H) + `<rect width="${width}" height="${FOOTER_H}" style="fill:${c('pane')}"/>` +
    `<rect x="${openInbox.x + 0.5}" y="${top}" width="${openInbox.w - 1}" height="${BUTTON_H}" rx="11" style="fill:${c('prim')}"/>` +
    (hover === 'open-inbox' ? `<rect x="${openInbox.x + 0.5}" y="${top}" width="${openInbox.w - 1}" height="${BUTTON_H}" rx="11" ` +
      `fill="#FFFFFF" fill-opacity=".14"/>` : '') +
    label(openInbox.x, openInbox.w, 'Open Inbox', c('onprim')) +
    `<rect x="${sources.x + 0.5}" y="${top + 0.5}" width="${sources.w - 1}" height="${BUTTON_H - 1}" rx="11" ` +
    `style="fill:${hover === 'inbox-sources' ? c('card2') : 'none'};stroke:${c('line2')}"/>` + label(sources.x, sources.w, 'Inbox sources', c('ink')) +
    (width - noteX > 170
      ? `<text x="${width - 2}" y="${top + 26}" text-anchor="end" ${SANS} font-size="13" style="fill:${c('muted')}">Changes apply right away</text>`
      : '') + '</svg>'
}
