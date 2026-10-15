// Agents' desktop pictures (screen F1): the title and tiles, the section labels, one picture per run,
// and the status row's band. Plain TypeScript, no engine, so they render in tests and the preview.

import { SANS, SVG_STYLE, c, esc, fit, icon, textWidth, type TokenName } from '../../ui/theme.ts'
import { panel, type Part } from '../../ui/kit.ts'
import { modelName } from '../../core/prices.ts'
import { crab } from './crabs.ts'
import {
  barOf, contextPercent, elapsed, fmtCost, fmtTime, fmtTokens, lookOf, totals, type AgentRun, type AgentsState, type BandSummary, type Look,
} from './model.ts'

export const LOOK_COLOR: Record<Look, TokenName> = {
  fable: 'teal', heavy: 'orange', careful: 'amber', medium: 'blue', light: 'green', explore: 'muted',
}

/** The group's title, then Cost, Tokens and Time. */
export function headerSvg(width: number, state: AgentsState): { svg: string; height: number } {
  const sum = totals(state)
  let body = `<text x="2" y="22" ${SANS} font-size="19" font-weight="700" style="fill:${c('ink')}">${fit(state.title || 'Agents', width - 4, 19, true)}</text>`
  const gap = 8
  const tileW = (width - gap * 2) / 3
  const tiles: [string, string][] = [
    ['Cost', `${sum.isExact ? '' : '≈'}${fmtCost(sum.cost)}`], ['Tokens', fmtTokens(sum.tokens)], ['Time', fmtTime(sum.time)],
  ]
  tiles.forEach(([label, value], index) => {
    const x = index * (tileW + gap)
    body += `<rect x="${x}" y="36" width="${tileW}" height="58" rx="12" style="fill:${c('card')}"/>` +
      `<text x="${x + 12}" y="56" ${SANS} font-size="13.5" style="fill:${c('muted')}">${label}</text>` +
      `<text x="${x + 12}" y="82" ${SANS} font-size="19" font-weight="700" style="fill:${c('ink')}">${esc(value)}</text>`
  })
  return { svg: panel(width, 98, body), height: 98 }
}

/** "Running · 1", "▾ Finished · 3": a section label; Finished folds. */
export function sectionSvg(width: number, label: string, key: string, hover: string): { svg: string; parts: Part[] } {
  const parts: Part[] = key ? [{ key, leftPx: 0, widthPx: Math.min(width, textWidth(label, 15) + 30), topPx: 0, heightPx: 28 }] : []
  const color = key && hover === key ? c('ink') : c('muted')
  return { svg: panel(width, 28, `<text x="2" y="20" ${SANS} font-size="15" letter-spacing="1.3" style="fill:${color}">${esc(label)}</text>`), parts }
}

export const ROW_H = 92

/** One run: crab, title and state, type with model and effort, the numbers, and its bar. */
export function runSvg(width: number, run: AgentRun & { depth: number }, now: number, isLast: boolean): string {
  const look = lookOf(run)
  const color = c(LOOK_COLOR[look])
  const indent = Math.min(3, run.depth) * 20
  const x = indent + 52
  const right = width - 2
  const isEnded = run.status === 'stopped' || run.status === 'failed'
  let body = crab(look, indent + 2, 14, 40, isEnded)
  // Title, and its state at the right.
  let stateW = 0
  if (run.status === 'done') {
    body += icon('check', right - 20, 10, 20, c('green'))
    stateW = 28
  } else if (isEnded) {
    const text = run.status === 'stopped' ? 'stopped' : `failed: ${run.failure ?? 'error'}`
    stateW = textWidth(text, 13.5, true) + 10
    body += `<text x="${right}" y="25" text-anchor="end" ${SANS} font-size="13.5" font-weight="600" style="fill:${c(run.status === 'stopped' ? 'muted' : 'red')}">${esc(text)}</text>`
  }
  const tags = [run.round > 1 ? `round ${run.round}` : '', run.isTeammate ? 'teammate' : ''].filter(Boolean).join(' · ')
  body += `<text x="${x}" y="25" ${SANS} font-size="15.5" font-weight="600" style="fill:${c('ink')}">${fit(run.description + (tags ? ` · ${tags}` : ''), right - x - stateW - 6, 15.5, true)}</text>`
  // The type in its look's color, then model and effort.
  const type = run.type.replace(/^[^:]*:/, '')
  const model = [run.model ? modelName(run.model) : '', run.effort ?? ''].filter(Boolean).join(' · ')
  // One text, so the font spaces the type and the model itself.
  body += `<text x="${x}" y="46" ${SANS} font-size="13.5" xml:space="preserve"><tspan style="fill:${color}">${fit(type, (right - x) / 2, 13.5)}</tspan>` +
    (model ? `<tspan style="fill:${c('muted')}">  ${fit(model, (right - x) / 2, 13.5)}</tspan>` : '') + '</text>'
  // Steps at the left; context, tokens, cost and time at the right.
  const numbers = `ctx ${contextPercent(run)}% · ${fmtTokens(run.tokens)} ≈${fmtCost(run.costUsd)} ${fmtTime(elapsed(run, now))}`
  body += `<text x="${x}" y="66" ${SANS} font-size="13" font-weight="500" style="fill:${c('ink')}">${run.steps} ${run.steps === 1 ? 'step' : 'steps'}</text>` +
    `<text x="${right}" y="66" text-anchor="end" ${SANS} font-size="13" style="fill:${c('muted')}">${esc(numbers)}</text>`
  const bar = barOf(run)
  body += `<rect x="${x}" y="74" width="${right - x}" height="5" rx="2.5" style="fill:${c('track')}"/>` +
    (bar.fraction > 0 ? `<rect x="${x}" y="74" width="${Math.max(5, (right - x) * bar.fraction)}" height="5" rx="2.5" style="fill:${bar.isColored ? color : c('bar2')}"/>` : '')
  if (!isLast) body += `<line x1="${indent}" x2="${width}" y1="${ROW_H - 0.5}" y2="${ROW_H - 0.5}" style="stroke:${c('line')}"/>`
  return panel(width, ROW_H, body)
}

/** A few words when nothing has run yet. */
export function emptySvg(width: number): string {
  return panel(width, 70, `<text x="2" y="26" ${SANS} font-size="19" font-weight="700" style="fill:${c('ink')}">No agents yet</text>` +
    `<text x="2" y="54" ${SANS} font-size="15" style="fill:${c('muted')}">${fit('When Claude starts subagents, they show here as they work.', width - 4, 15)}</text>`)
}

// ---- above the prompt ----------------------------------------------------------------------------

export const BAND_H = 34

/** Stable noise per cell, so the dither doesn't shimmer between draws. */
const noise = (x: number, y: number) => {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return n - Math.floor(n)
}

/**
 * The status row's Agents part: a teal dot, the title (at most 40% of the width), the dithered bar with
 * its pill, the %, the crab, then ×N (shows or hides the pane) and ✕ (hides this row for this group).
 */
export function bandSvg(width: number, band: BandSummary, hover: string): { svg: string; parts: Part[] } {
  const mid = BAND_H / 2
  let body = `<rect width="${width}" height="${BAND_H}" style="fill:${c('band')}"/>` +
    `<circle cx="8" cy="${mid}" r="6" style="fill:${c('teal')}"/>`
  const titleW = Math.min(textWidth(band.title, 16, true), width * 0.4)
  body += `<text x="22" y="${mid + 5.5}" ${SANS} font-size="16" font-weight="700" style="fill:${c('ink')}">${fit(band.title, width * 0.4, 16, true)}</text>`
  // The right side: %, crab, ×N, ✕.
  const close = { w: 26, key: 'band:agents-hide' }
  const count = `×${band.running}`
  const countW = textWidth(count, 15, true) + 16
  const percent = `${Math.round(band.fraction * 100)}%`
  const percentW = textWidth(percent, 15) + 8
  let x = width - close.w
  const parts: Part[] = [{ key: close.key, leftPx: x, widthPx: close.w, topPx: 0, heightPx: BAND_H }]
  body += icon('close', x + 5, mid - 8, 16, hover === close.key ? c('ink') : c('muted'))
  x -= countW + 4
  parts.push({ key: 'band:agents', leftPx: x, widthPx: countW, topPx: 2, heightPx: BAND_H - 4 })
  body += `<rect x="${x + 0.5}" y="4.5" width="${countW - 1}" height="${BAND_H - 9}" rx="12.5" style="fill:${hover === 'band:agents' ? c('card2') : 'none'};stroke:${c('line2')}"/>` +
    `<text x="${x + countW / 2}" y="${mid + 5}" text-anchor="middle" ${SANS} font-size="15" font-weight="600" style="fill:${c('ink')}">${count}</text>`
  x -= 34
  body += crab(band.look, x + 4, mid - 11, 26)
  x -= percentW
  body += `<text x="${x}" y="${mid + 5}" ${SANS} font-size="15" style="fill:${c('muted')}">${percent}</text>`
  // The bar between the title and the %.
  const barX = 22 + titleW + 14
  const barW = Math.max(60, x - 10 - barX)
  const barY = mid - 13
  const barH = 26
  body += `<clipPath id="bar"><rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="${barH / 2}"/></clipPath>` +
    `<rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="${barH / 2}" style="fill:${c('track')}"/>`
  // Dither: 3 px cells, denser toward the filled end.
  const filled = barW * band.fraction
  let dots = ''
  for (let cx = 0; cx < filled; cx += 3) {
    for (let cy = 0; cy < barH; cy += 3) {
      if (noise(cx, cy) < 0.25 + 0.65 * (cx / Math.max(1, filled))) dots += `M${barX + cx} ${barY + cy}h2v2h-2z`
    }
  }
  if (dots) body += `<g clip-path="url(#bar)"><path d="${dots}" style="fill:${c('teal')}" opacity=".75"/></g>`
  // The pill with "2/4 done", centered on the bar.
  const pillW = Math.min(barW - 8, textWidth(band.label, 14, true) + 28)
  const pillX = barX + (barW - pillW) / 2
  body += `<rect x="${pillX}" y="${barY + 2}" width="${pillW}" height="${barH - 4}" rx="${(barH - 4) / 2}" style="fill:${c('teal')}"/>` +
    `<text x="${pillX + pillW / 2}" y="${mid + 5}" text-anchor="middle" ${SANS} font-size="14" font-weight="600" fill="#FFFFFF">${esc(band.label)}</text>`
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${BAND_H}" viewBox="0 0 ${width} ${BAND_H}">${SVG_STYLE}${body}</svg>`, parts }
}
