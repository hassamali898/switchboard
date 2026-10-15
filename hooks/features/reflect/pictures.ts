// Reflect's card above the prompt (screen F6): "SAVE THIS AS A RULE?", the rule, what you said, where
// it goes, then the buttons. Plain TypeScript, no engine, so it renders in tests and the preview.

import { MONO, SANS, SVG_STYLE, c, esc, eyebrow, fit, icon, textWidth } from '../../ui/theme.ts'
import type { Part } from '../../ui/kit.ts'
import { sureText, type ReflectItem, type ReflectScope } from './model.ts'

/** A picture on the band's own gray. */
const bandPicture = (width: number, height: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${SVG_STYLE}` +
  `<rect width="${width}" height="${height}" style="fill:${c('band')}"/>${body}</svg>`

function wrap(text: string, maxPx: number, size: number, isBold = false): string[] {
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

export type CardInput = {
  item: ReflectItem
  /** What you said, when this session still has it. */
  quote: string
  scope: ReflectScope
  projectFile: string
  globalFile: string
}

const RULE_SIZE = 20
const OPT_H = 48

/** The card: the highlighted head with the rule, what you said, and the two places it can go. */
export function cardSvg(width: number, input: CardInput, hover: string): { svg: string; height: number; parts: Part[] } {
  const { item } = input
  const parts: Part[] = []
  const pad = 14
  const inner = width - pad * 2
  // The head: tile, eyebrow, ×N and how sure, then the rule.
  const headX = pad
  let y = pad
  const ruleLines = wrap(`“${item.rule}”`, inner - 64 - 20, RULE_SIZE, true).slice(0, 4)
  const headH = 16 + 46 + 6 + ruleLines.length * 28 + 12
  let body = `<rect x="${headX + 0.5}" y="${y + 0.5}" width="${inner - 1}" height="${headH - 1}" rx="16" style="fill:none;stroke:${c('line2')}"/>` +
    `<rect x="${headX + 18}" y="${y + 16}" width="46" height="46" rx="14" style="fill:${c('greenSoft')}"/>` +
    icon('bookmark', headX + 30, y + 28, 22, c('green')) +
    eyebrow('Save this as a rule?', headX + 82, y + 44, c('green'), 13)
  const sure = sureText(item.confidence)
  body += `<text x="${headX + inner - 18}" y="${y + 44}" text-anchor="end" ${SANS} font-size="15" style="fill:${c('muted')}">${esc(sure)}</text>`
  if (item.count > 1) {
    const times = `×${item.count}`
    const w = textWidth(times, 14, true) + 16
    const x = headX + inner - 18 - textWidth(sure, 15) - 10 - w
    body += `<rect x="${x}" y="${y + 29}" width="${w}" height="22" rx="11" style="fill:${c('greenSoft')}"/>` +
      `<text x="${x + w / 2}" y="${y + 45}" text-anchor="middle" ${SANS} font-size="14" font-weight="700" style="fill:${c('green')}">${times}</text>`
  }
  ruleLines.forEach((line, index) => {
    body += `<text x="${headX + 82}" y="${y + 16 + 46 + 24 + index * 28}" ${SANS} font-size="${RULE_SIZE}" font-weight="600" style="fill:${c('ink')}">${esc(line)}</text>`
  })
  y += headH + 14

  // What you said, then where it goes.
  const textX = pad + 82
  const textW = width - pad - textX
  if (input.quote) {
    const said = wrap(`From what you said: “${input.quote}”`, textW, 15).slice(0, 2)
    said.forEach((line, index) => {
      const lead = index === 0 ? 'From what you said: ' : ''
      const rest = index === 0 ? line.slice(lead.length) : line
      body += `<text x="${textX}" y="${y + 14 + index * 21}" ${SANS} font-size="15" xml:space="preserve">` +
        (lead ? `<tspan style="fill:${c('muted')}">${esc(lead)}</tspan>` : '') + `<tspan style="fill:${c('ink')}">${esc(rest)}</tspan></text>`
    })
    y += said.length * 21 + 12
  }
  body += eyebrow('Where it goes', textX, y + 14, c('muted'), 12.5)
  y += 26
  const option = (scope: ReflectScope, label: string, path: string) => {
    const key = `reflect:opt:${scope}`
    const isOn = input.scope === scope
    parts.push({ key, leftPx: textX, widthPx: textW, topPx: y, heightPx: OPT_H })
    const fill = isOn ? c('greenSel') : hover === key ? c('card2') : c('card')
    body += `<rect x="${textX + 0.5}" y="${y + 0.5}" width="${textW - 1}" height="${OPT_H - 1}" rx="12" style="fill:${fill};stroke:${isOn ? c('greenLine') : c('line')}"/>` +
      icon(scope === 'project' ? 'folder' : 'globe', textX + 18, y + OPT_H / 2 - 11, 22, isOn ? c('green') : c('muted')) +
      `<text x="${textX + 52}" y="${y + OPT_H / 2 + 6}" ${SANS} font-size="16.5" style="fill:${c('ink')}">${label}</text>`
    const room = textW - 52 - textWidth(label, 16.5) - 36
    body += `<text x="${textX + textW - 18}" y="${y + OPT_H / 2 + 5}" text-anchor="end" ${MONO} font-size="14" style="fill:${c('muted')}">${fit(path, room, 14 * 1.1)}</text>`
    y += OPT_H + 8
  }
  option('project', 'This project only', input.projectFile)
  option('global', 'All your projects', input.globalFile)
  const height = y + pad - 8
  const frame = `<rect x="0.75" y="0.75" width="${width - 1.5}" height="${height - 1.5}" rx="20" style="fill:${c('surface')};stroke:${c('frame')}" stroke-width="1.5"/>`
  return { svg: bandPicture(width, height, frame + body), height, parts }
}

const BUTTON_H = 46

/** Save for this project, Save for all projects, Reword, Don't save; the chosen place's save is the clay one. */
export function buttonsSvg(width: number, scope: ReflectScope, more: number, hover: string): { svg: string; height: number; parts: Part[] } {
  const parts: Part[] = []
  let body = ''
  let x = 0
  let y = 4
  const buttons: [string, string, 'primary' | 'outline' | 'text'][] = [
    ['reflect:save:project', 'Save for this project', scope === 'project' ? 'primary' : 'outline'],
    ['reflect:save:global', 'Save for all projects', scope === 'global' ? 'primary' : 'outline'],
    ['reflect:reword', 'Reword', 'outline'],
    ['reflect:skip', "Don't save", 'text'],
  ]
  for (const [key, label, look] of buttons) {
    const w = Math.round(textWidth(label, 15, true) * 0.92) + (look === 'text' ? 18 : 30) // the estimate runs wide on bold text
    if (x > 0 && x + w > width) {
      x = 0
      y += BUTTON_H + 10
    }
    parts.push({ key, leftPx: x, widthPx: w, topPx: y, heightPx: BUTTON_H })
    const isHover = hover === key
    const fill = look === 'primary' ? c('prim') : isHover ? c('card2') : 'none'
    const stroke = look === 'primary' ? c('prim') : look === 'outline' ? c('line2') : 'none'
    body += `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${BUTTON_H - 1}" rx="11" style="fill:${fill};stroke:${stroke}"/>` +
      (look === 'primary' && isHover ? `<rect x="${x}" y="${y}" width="${w}" height="${BUTTON_H}" rx="11" fill="#FFFFFF" fill-opacity=".14"/>` : '') +
      `<text x="${x + w / 2}" y="${y + BUTTON_H / 2 + 5.5}" text-anchor="middle" ${SANS} font-size="15" font-weight="600" ` +
      `style="fill:${look === 'primary' ? c('onprim') : look === 'text' ? c('muted') : c('ink')}">${esc(label)}</text>`
    x += w + 10
  }
  if (more > 0) {
    const text = `+${more} more · /sb-reflect`
    if (x + textWidth(text, 14.5) + 8 > width) {
      y += BUTTON_H + 6
      x = 0
    }
    body += `<text x="${x === 0 ? 2 : width - 2}" y="${y + BUTTON_H / 2 + 5}" text-anchor="${x === 0 ? 'start' : 'end'}" ${SANS} font-size="14.5" style="fill:${c('muted')}">${esc(text)}</text>`
  }
  const height = y + BUTTON_H + 4
  return { svg: bandPicture(width, height, body), height, parts }
}

const C_BUTTON_H = 36
const C_OPT_H = 34

/**
 * The whole card in one short picture, for a band too low for the full card and its buttons: the
 * eyebrow and how sure on one line, the rule, what you said on one line, the two places side by side
 * (stacked when narrow), then the buttons, all inside the frame. Same keys as the full card's parts.
 */
export function compactSvg(width: number, input: CardInput, more: number, hover: string): { svg: string; height: number; parts: Part[] } {
  const { item } = input
  const parts: Part[] = []
  const pad = 12
  const x0 = pad + 32 + 14
  const cw = width - pad - x0
  let y = pad
  let body = `<rect x="${pad}" y="${y}" width="32" height="32" rx="10" style="fill:${c('greenSoft')}"/>` +
    icon('bookmark', pad + 7, y + 7, 18, c('green')) +
    eyebrow('Save this as a rule?', x0, y + 15, c('green'), 12)
  const sure = sureText(item.confidence)
  body += `<text x="${width - pad - 4}" y="${y + 15}" text-anchor="end" ${SANS} font-size="13.5" style="fill:${c('muted')}">${esc(sure)}</text>`
  if (item.count > 1) {
    const times = `×${item.count}`
    const w = textWidth(times, 13, true) + 14
    const x = width - pad - 4 - textWidth(sure, 13.5) - 8 - w
    body += `<rect x="${x}" y="${y + 1}" width="${w}" height="20" rx="10" style="fill:${c('greenSoft')}"/>` +
      `<text x="${x + w / 2}" y="${y + 15}" text-anchor="middle" ${SANS} font-size="13" font-weight="700" style="fill:${c('green')}">${times}</text>`
  }
  y += 24
  const ruleLines = wrap(`“${item.rule}”`, cw - 4, 17, true).slice(0, 2)
  ruleLines.forEach((line, index) => {
    body += `<text x="${x0}" y="${y + 17 + index * 23}" ${SANS} font-size="17" font-weight="600" style="fill:${c('ink')}">${esc(line)}</text>`
  })
  y += ruleLines.length * 23 + 4
  if (input.quote) {
    const lead = 'From what you said: '
    const rest = fit(`“${input.quote}”`, cw - textWidth(lead, 13.5) - 4, 13.5)
    body += `<text x="${x0}" y="${y + 13}" ${SANS} font-size="13.5" xml:space="preserve"><tspan style="fill:${c('muted')}">${lead}</tspan>` +
      `<tspan style="fill:${c('ink')}">${esc(rest)}</tspan></text>`
    y += 18 + 8
  }

  // The two places: side by side when each gets 230 px, else one under the other.
  const isSide = (cw - 8) / 2 >= 230
  const optW = isSide ? (cw - 8) / 2 : cw
  const option = (scope: ReflectScope, label: string, path: string, x: number, top: number) => {
    const key = `reflect:opt:${scope}`
    const isOn = input.scope === scope
    parts.push({ key, leftPx: x, widthPx: optW, topPx: top, heightPx: C_OPT_H })
    const fill = isOn ? c('greenSel') : hover === key ? c('card2') : c('card')
    body += `<rect x="${x + 0.5}" y="${top + 0.5}" width="${optW - 1}" height="${C_OPT_H - 1}" rx="10" style="fill:${fill};stroke:${isOn ? c('greenLine') : c('line')}"/>` +
      icon(scope === 'project' ? 'folder' : 'globe', x + 12, top + C_OPT_H / 2 - 8, 16, isOn ? c('green') : c('muted')) +
      `<text x="${x + 36}" y="${top + C_OPT_H / 2 + 5}" ${SANS} font-size="14" style="fill:${c('ink')}">${label}</text>`
    const room = optW - 36 - textWidth(label, 14) - 24
    if (room >= 60) {
      body += `<text x="${x + optW - 12}" y="${top + C_OPT_H / 2 + 4.5}" text-anchor="end" ${MONO} font-size="12" style="fill:${c('muted')}">${fit(path, room, 12 * 1.1)}</text>`
    }
  }
  option('project', 'This project only', input.projectFile, x0, y)
  option('global', 'All your projects', input.globalFile, isSide ? x0 + optW + 8 : x0, isSide ? y : y + C_OPT_H + 6)
  y += (isSide ? C_OPT_H : C_OPT_H * 2 + 6) + 10

  // The buttons, wrapping inside the frame.
  const buttons: [string, string, 'primary' | 'outline' | 'text'][] = [
    ['reflect:save:project', 'Save for this project', input.scope === 'project' ? 'primary' : 'outline'],
    ['reflect:save:global', 'Save for all projects', input.scope === 'global' ? 'primary' : 'outline'],
    ['reflect:reword', 'Reword', 'outline'],
    ['reflect:skip', "Don't save", 'text'],
  ]
  const right = width - pad
  let x = x0
  for (const [key, label, look] of buttons) {
    const w = Math.round(textWidth(label, 14, true) * 0.92) + (look === 'text' ? 16 : 26)
    if (x > x0 && x + w > right) {
      x = x0
      y += C_BUTTON_H + 8
    }
    parts.push({ key, leftPx: x, widthPx: w, topPx: y, heightPx: C_BUTTON_H })
    const isHover = hover === key
    const fill = look === 'primary' ? c('prim') : isHover ? c('card2') : 'none'
    const stroke = look === 'primary' ? c('prim') : look === 'outline' ? c('line2') : 'none'
    body += `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${C_BUTTON_H - 1}" rx="10" style="fill:${fill};stroke:${stroke}"/>` +
      (look === 'primary' && isHover ? `<rect x="${x}" y="${y}" width="${w}" height="${C_BUTTON_H}" rx="10" fill="#FFFFFF" fill-opacity=".14"/>` : '') +
      `<text x="${x + w / 2}" y="${y + C_BUTTON_H / 2 + 5}" text-anchor="middle" ${SANS} font-size="14" font-weight="600" ` +
      `style="fill:${look === 'primary' ? c('onprim') : look === 'text' ? c('muted') : c('ink')}">${esc(label)}</text>`
    x += w + 8
  }
  if (more > 0) {
    const text = `+${more} more · /sb-reflect`
    if (x + textWidth(text, 13) + 4 > right) {
      x = x0
      y += C_BUTTON_H + 4
    }
    body += `<text x="${right - 4}" y="${y + C_BUTTON_H / 2 + 4.5}" text-anchor="end" ${SANS} font-size="13" style="fill:${c('muted')}">${esc(text)}</text>`
  }
  const height = y + C_BUTTON_H + pad
  const frame = `<rect x="0.75" y="0.75" width="${width - 1.5}" height="${height - 1.5}" rx="16" style="fill:${c('surface')};stroke:${c('frame')}" stroke-width="1.5"/>`
  return { svg: bandPicture(width, height, frame + body), height, parts }
}
