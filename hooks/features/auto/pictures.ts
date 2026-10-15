// Auto's pictures: the rule card /sb-auto makes and the send check above the prompt in the Inbox session
// (screens 7 and 5), the Auto pane (screen 7) and the one-line Auto band. Plain TypeScript, no engine.

import { SANS, SERIF, SVG_STYLE, c, esc, eyebrow, fit, icon, textWidth, type TokenName } from '../../ui/theme.ts'
import { panel, pill, pillWidth, type Part, type PillTone } from '../../ui/kit.ts'
import {
  checksOf, clock, doneToday, onlyIf, rightNowText, ruleSummary, sourcesText, taskText, waitingFor, whatGoes, UNDOABLE,
  type AutoDo, type AutoDraft, type AutoLogEntry, type AutoRule, type AutoState, type AutoTask, type Check,
} from './model.ts'
import type { InboxItem } from '../inbox/model.ts'

const bandPicture = (width: number, height: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${SVG_STYLE}` +
  `<rect width="${width}" height="${height}" style="fill:${c('band')}"/>${body}</svg>`

const frame = (width: number, height: number, radius = 16) =>
  `<rect x="0.75" y="0.75" width="${width - 1.5}" height="${height - 1.5}" rx="${radius}" style="fill:${c('surface')};stroke:${c('frame')}" stroke-width="1.5"/>`

const cardBox = (width: number, height: number) =>
  `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="16" style="fill:${c('card')};stroke:${c('line')}"/>`

function wrap(text: string, maxPx: number, size: number, isBold = false): string[] {
  const out: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (line && textWidth(next, size, isBold) * 0.95 > maxPx) {
      out.push(line)
      line = word
    } else line = next
  }
  if (line) out.push(line)
  return out
}

/** At most `count` lines; the last ends in "…" when there was more. */
function lines(text: string, maxPx: number, size: number, count: number, isBold = false): string[] {
  const all = wrap(text.replace(/\s+/g, ' ').trim(), maxPx, size, isBold)
  if (all.length <= count) return all
  const kept = all.slice(0, count)
  kept[count - 1] = fit(`${kept[count - 1]} ${all[count]}`, maxPx, size, isBold)
  if (!kept[count - 1]!.endsWith('…')) kept[count - 1] = `${kept[count - 1]}…`
  return kept
}

type Look = 'primary' | 'outline' | 'text' | 'focus' | 'link'

/** Buttons in a row from `x0`; each `[key, label, look]`. `focus` is the design's outlined default. */
function buttons(list: readonly [string, string, Look][], x0: number, top: number, hover: string, h = 38, size = 14.5):
  { body: string; parts: Part[]; endX: number } {
  const parts: Part[] = []
  let body = ''
  let x = x0
  for (const [key, label, look] of list) {
    const w = Math.round(textWidth(label, size, true) * 0.92) + (look === 'text' || look === 'link' ? 16 : 30)
    parts.push({ key, leftPx: x, widthPx: w, topPx: top, heightPx: h })
    const isHover = hover === key
    const fill = look === 'primary' ? c('prim') : isHover ? c('card2') : 'none'
    const stroke = look === 'primary' ? c('prim') : look === 'outline' || look === 'focus' ? c('line2') : 'none'
    const color = look === 'primary' ? c('onprim') : look === 'text' ? c('muted') : look === 'link' ? c('orange') : c('ink')
    body += (look === 'focus' ? `<rect x="${x - 3.5}" y="${top - 3.5}" width="${w + 7}" height="${h + 7}" rx="13" style="fill:none;stroke:${c('focus')}" stroke-width="2"/>` : '') +
      `<rect x="${x + 0.5}" y="${top + 0.5}" width="${w - 1}" height="${h - 1}" rx="11" style="fill:${fill};stroke:${stroke}"/>` +
      (look === 'primary' && isHover ? `<rect x="${x}" y="${top}" width="${w}" height="${h}" rx="11" fill="#FFFFFF" fill-opacity=".14"/>` : '') +
      `<text x="${x + w / 2}" y="${top + h / 2 + size / 3}" text-anchor="middle" ${SANS} font-size="${size}" font-weight="600" style="fill:${color}">${esc(label)}</text>`
    x += w + 10
  }
  return { body, parts, endX: x - 10 }
}

const AVATAR_COLORS = ['#788C5D', '#6A9BCC', '#C46686', '#D97757', '#5FB3A8', '#B08A3E']

const initials = (name: string) => {
  const words = name.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean)
  return ((words[0]?.[0] ?? '?') + (words[1]?.[0] ?? '')).toUpperCase()
}

/** A rounded-square initials avatar, as the design's people rows. */
function avatar(x: number, y: number, size: number, name: string): string {
  const color = AVATAR_COLORS[[...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % AVATAR_COLORS.length]!
  return `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${Math.round(size * 0.32)}" fill="${color}"/>` +
    `<text x="${x + size / 2}" y="${y + size / 2 + size * 0.13}" text-anchor="middle" ${SANS} font-size="${(size * 0.36).toFixed(1)}" font-weight="700" fill="#FFFFFF">${esc(initials(name))}</text>`
}

const DO_LOOK: Record<AutoDo, { icon: string; fg: TokenName; bg: TokenName }> = {
  reply: { icon: 'mail', fg: 'red', bg: 'redSoft' }, review: { icon: 'branch', fg: 'muted', bg: 'card2' },
  book: { icon: 'calendar', fg: 'amber', bg: 'amberSoft' }, archive: { icon: 'lines', fg: 'slack', bg: 'slackSoft' },
}

const WHEN_ICON: Record<string, string> = { question: 'chat', pr_review: 'chat', meeting: 'person', fyi: 'mail' }

/** An icon on its tinted rounded square. */
function tile(x: number, y: number, size: number, name: string, fg: TokenName, bg: TokenName): string {
  const inner = Math.round(size * 0.54)
  return `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${Math.round(size * 0.3)}" style="fill:${c(bg)}"/>` +
    icon(name, x + (size - inner) / 2, y + (size - inner) / 2, inner, c(fg))
}

/** Ask first | Auto, the chosen one raised. */
function modeSwitch(right: number, top: number, mode: 'ask' | 'auto', hover: string, prefix: string): { body: string; parts: Part[] } {
  const labels: ['ask' | 'auto', string][] = [['ask', 'Ask first'], ['auto', 'Auto']]
  const widths = labels.map(([, label]) => textWidth(label, 13.5, true) + 24)
  const total = widths.reduce((a, b) => a + b, 0) + 6
  let x = right - total
  let body = `<rect x="${x}" y="${top}" width="${total}" height="34" rx="11" style="fill:${c('card2')}"/>`
  const parts: Part[] = []
  x += 3
  labels.forEach(([key, label], index) => {
    const w = widths[index]!
    const isOn = mode === key
    const partKey = `${prefix}:${key}`
    parts.push({ key: partKey, leftPx: x, widthPx: w, topPx: top + 3, heightPx: 28 })
    if (isOn) body += `<rect x="${x}" y="${top + 3}" width="${w}" height="28" rx="9" style="fill:${c('card')};stroke:${c('line')}"/>`
    else if (hover === partKey) body += `<rect x="${x}" y="${top + 3}" width="${w}" height="28" rx="9" style="fill:${c('line')}"/>`
    body += `<text x="${x + w / 2}" y="${top + 22}" text-anchor="middle" ${SANS} font-size="13.5" font-weight="${isOn ? 700 : 500}" style="fill:${isOn ? c('ink') : c('muted')}">${label}</text>`
    x += w
  })
  return { body, parts }
}

// ---- The rule card (screen 7, in the band) ---------------------------------------------------------

/** The rule Haiku made from /sb-auto: who, Ask first | Auto, When → Do, Only if, Save rule and Edit. */
export function ruleCardSvg(width: number, draft: AutoDraft, hover: string): { svg: string; height: number; parts: Part[] } {
  const pad = 16
  const inner = width - pad * 2
  const parts: Part[] = []
  let body = ''
  let y = pad
  const rule = draft.rule
  if (!rule || draft.phase === 'making' || draft.phase === 'error') {
    const said = lines(draft.request, inner - 20, 14, 2)
    body += eyebrow(draft.phase === 'error' ? 'Auto · couldn\'t make a rule' : 'Auto · making the rule', pad, y + 12, draft.phase === 'error' ? c('red') : c('orange'), 12)
    y += 22
    said.forEach((line, index) => { body += `<text x="${pad}" y="${y + 16 + index * 20}" ${SANS} font-size="14" style="fill:${c('muted')}">${esc(line)}</text>` })
    y += said.length * 20 + 6
    if (draft.phase === 'error') {
      body += `<text x="${pad}" y="${y + 16}" ${SANS} font-size="14.5" style="fill:${c('ink')}">${esc(fit(draft.error, inner, 14.5))}</text>`
      y += 26
      const row = buttons([['auto:rule:dismiss', 'Dismiss', 'outline']], pad, y, hover, 34, 14)
      body += row.body
      parts.push(...row.parts)
      y += 34
    }
    const height = y + pad
    return { svg: bandPicture(width, height, frame(width, height) + body), height, parts }
  }
  // Who, and the switch.
  if (rule.person) body += avatar(pad, y, 38, rule.person)
  else body += tile(pad, y, 38, 'bolt', 'orange', 'orangeSoft')
  const isSaved = draft.phase === 'saved'
  const toggle = modeSwitch(width - pad, y + 2, rule.mode, hover, 'auto:rule:mode')
  const nameW = inner - 50 - (width - pad - toggle.parts[0]!.leftPx) - 10
  body += `<text x="${pad + 50}" y="${y + 17}" ${SERIF} font-size="19" font-weight="500" style="fill:${c('ink')}">${esc(fit(rule.name, nameW, 19))}</text>` +
    `<text x="${pad + 50}" y="${y + 35}" ${SANS} font-size="13.5" style="fill:${c('muted')}">${esc(fit(sourcesText(rule), nameW, 13.5))}</text>` + toggle.body
  parts.push(...toggle.parts)
  y += 46
  // When → Do.
  const half = (inner - 30) / 2
  for (const pair of rule.pairs) {
    const look = DO_LOOK[pair.do]
    body += `<rect x="${pad}" y="${y}" width="${half}" height="32" rx="11" style="fill:${c('card2')}"/>` +
      icon(WHEN_ICON[pair.when] ?? 'chat', pad + 10, y + 8.5, 15, c('muted')) +
      `<text x="${pad + 32}" y="${y + 21}" ${SANS} font-size="14" style="fill:${c('ink')}">${esc(fit(pair.whenText, half - 42, 14))}</text>` +
      icon('arrow', pad + half + 7.5, y + 8.5, 15, c('faint')) +
      `<rect x="${pad + half + 30}" y="${y}" width="${half}" height="32" rx="11" style="fill:${c(look.bg)}"/>` +
      icon(look.icon, pad + half + 40, y + 8.5, 15, c(look.fg === 'muted' ? 'ink' : look.fg)) +
      `<text x="${pad + half + 62}" y="${y + 21}" ${SANS} font-size="14" font-weight="600" style="fill:${c(look.fg === 'muted' ? 'ink' : look.fg)}">${esc(fit(pair.doText, half - 72, 14, true))}</text>`
    y += 35
  }
  // Only if.
  body += `<text x="${pad}" y="${y + 17}" ${SANS} font-size="13.5" style="fill:${c('muted')}">Only if</text>`
  let x = pad + textWidth('Only if', 13.5) + 10
  for (const chip of onlyIf(rule)) {
    const w = textWidth(chip, 13) + 20
    if (x + w > width - pad) break
    body += `<rect x="${x + 0.5}" y="${y + 1.5}" width="${w - 1}" height="24" rx="12" style="fill:none;stroke:${c('line2')}"/>` +
      `<text x="${x + w / 2}" y="${y + 18}" text-anchor="middle" ${SANS} font-size="13" style="fill:${c('muted')}">${esc(chip)}</text>`
    x += w + 6
  }
  y += 32
  body += `<rect x="${pad}" y="${y}" width="${inner}" height="1" style="fill:${c('line')}"/>`
  y += 10
  const row = isSaved
    ? buttons([['auto:rule:open', 'Open Auto', 'outline'], ['auto:rule:done', 'Done', 'text']], pad, y, hover, 34, 14)
    : buttons([['auto:rule:save', 'Save rule', 'primary'], ['auto:rule:edit', 'Edit', 'outline'], ['auto:rule:dismiss', 'Cancel', 'text']], pad, y, hover, 34, 14)
  body += row.body
  parts.push(...row.parts)
  const note = isSaved ? `✓ Rule active · ${rule.mode === 'auto' ? 'Auto' : 'Ask first'}` : 'Message text never becomes a command'
  const noteW = width - pad - row.endX - 16
  if (noteW > 80) {
    body += `<text x="${width - pad}" y="${y + 22}" text-anchor="end" ${SANS} font-size="13" font-weight="${isSaved ? 600 : 400}" style="fill:${isSaved ? c('green') : c('muted')}">${esc(fit(note, noteW, 13))}</text>`
  }
  y += 34
  const height = y + pad - 2
  return { svg: bandPicture(width, height, frame(width, height) + body), height, parts }
}

// ---- The send check (screen 5, in the band) --------------------------------------------------------

/** "to Sara Khan, in the Gmail thread “Q4 roadmap review”". */
export function whereText(task: AutoTask, item: InboxItem | null): string {
  if (!item) return task.target
  if (task.do === 'reply') return `to ${item.from.name}, in the ${item.source === 'gmail' ? 'Gmail thread' : 'Slack conversation'}${item.title ? ` “${item.title}”` : ''}`
  if (task.do === 'review') return `on ${task.title.replace(/^Review /, '')}, asked by ${item.from.name}`
  if (task.do === 'book') return `with ${item.from.name}${item.from.email ? ` <${item.from.email}>` : ''}`
  return `${item.from.name}'s message`
}

/** What the agent will do, in the quote box, for actions that aren't a reply. */
export function plannedText(task: AutoTask, rule: AutoRule | null): string {
  if (task.do === 'review') return `Read the PR and its diff, then post one review with line comments and a summary as you. It never approves or merges.${rule?.instructions ? ` ${rule.instructions}` : ''}`
  if (task.do === 'book') return `Find a free slot and send one invite.${rule?.instructions ? ` ${rule.instructions}` : ' 30 min, in work hours.'}`
  if (task.do === 'archive') return 'Mark it read and move it out of Needs you. Undo puts it back.'
  return taskText(task)
}

function checkLine(x: number, baseline: number, maxW: number, check: Check): string {
  const [label, count] = check.text.split('|')
  let body = icon(check.isOk ? 'check' : 'close', x, baseline - 14, 17, check.isOk ? c('green') : c('red')) +
    `<text x="${x + 26}" y="${baseline}" ${SANS} font-size="14.5" style="fill:${c('ink')}">${esc(fit(label ?? '', maxW - 26 - (count ? 110 : 0), 14.5))}</text>`
  if (count) {
    const [used, , cap] = count.split(' ')
    const share = Math.min(1, Number(used) / Math.max(1, Number(cap)))
    const meterX = x + maxW - 64
    body += `<text x="${meterX - 8}" y="${baseline}" text-anchor="end" ${SANS} font-size="14.5" font-weight="700" style="fill:${c('ink')}">${esc(count)}</text>` +
      `<rect x="${meterX}" y="${baseline - 8}" width="60" height="7" rx="3.5" style="fill:${c('track')}"/>` +
      `<rect x="${meterX}" y="${baseline - 8}" width="${(60 * share).toFixed(1)}" height="7" rx="3.5" style="fill:${c('bar')}"/>`
  }
  return body
}

/** The held action: what goes to whom, the four checks, Send / Edit first / Don't send. */
export function checkCardSvg(width: number, state: AutoState, task: AutoTask, rule: AutoRule | null, item: InboxItem | null, now: number,
                             hover: string, isCompact: boolean): { svg: string; height: number; parts: Part[] } {
  const pad = isCompact ? 14 : 20
  const inner = width - pad * 2
  const tileSize = isCompact ? 40 : 52
  let body = tile(pad, pad, tileSize, task.do === 'reply' ? 'send' : DO_LOOK[task.do].icon, 'orange', 'orangeSoft')
  const x0 = pad + tileSize + 14
  const textW = width - pad - x0
  const lead = `Your ${rule?.name ?? task.ruleName} rule wants to ${task.do === 'archive' ? 'archive' : 'send'} `
  const what = task.do === 'archive' ? '1 message' : whatGoes(task)
  const titleSize = isCompact ? 17 : 21
  const leadFit = fit(lead, textW - textWidth(what, titleSize, true) - 6, titleSize)
  body += `<text x="${x0}" y="${pad + (isCompact ? 16 : 20)}" ${SERIF} font-size="${titleSize}" font-weight="500" xml:space="preserve" style="fill:${c('ink')}">` +
    `${esc(leadFit)}<tspan style="fill:${c('orange')}">${esc(what)}</tspan></text>` +
    `<text x="${x0}" y="${pad + (isCompact ? 35 : 44)}" ${SANS} font-size="${isCompact ? 13.5 : 15}" style="fill:${c('muted')}">${esc(fit(whereText(task, item), textW, isCompact ? 13.5 : 15))}</text>`
  let y = pad + tileSize + (isCompact ? 8 : 14)
  if (!isCompact) {
    body += `<rect x="${pad}" y="${y}" width="${inner}" height="40" rx="12" style="fill:${c('amberSoft')};stroke:${c('amber')}" stroke-opacity=".45"/>` +
      icon('shield', pad + 14, y + 10, 20, c('amber')) +
      `<text x="${pad + 44}" y="${y + 25}" ${SANS} font-size="15" style="fill:${c('amber')}">${esc(fit('This rule is set to Ask first, so nothing goes out until you say so.', inner - 56, 15))}</text>`
    y += 52
  }
  const quoteSize = isCompact ? 14.5 : 16
  const quoteLines = lines(task.state === 'running' ? 'Drafting…' : task.do === 'reply' ? taskText(task) : plannedText(task, rule), inner - 32, quoteSize, isCompact ? 2 : 3)
  const lineH = quoteSize * 1.4
  const quoteH = quoteLines.length * lineH + (isCompact ? 14 : 22)
  body += `<rect x="${pad}" y="${y}" width="${inner}" height="${quoteH}" rx="12" style="fill:${c('card2')};stroke:${c('line')}"/>`
  quoteLines.forEach((line, index) => {
    body += `<text x="${pad + 16}" y="${y + (isCompact ? 7 : 11) + lineH * (index + 0.75)}" ${SANS} font-size="${quoteSize}" style="fill:${c('ink')}">${esc(line)}</text>`
  })
  y += quoteH + (isCompact ? 8 : 12)
  const checks = checksOf(state, task, rule, item, now)
  if (isCompact) {
    const colW = (inner - 16) / 2
    checks.forEach((check, index) => {
      body += checkLine(pad + (index % 2) * (colW + 16), y + 16 + Math.floor(index / 2) * 22, colW, check)
    })
    y += 50
  } else {
    checks.forEach((check, index) => { body += checkLine(pad, y + 18 + index * 30, inner, check) })
    y += checks.length * 30 + 8
  }
  const isSending = task.state === 'sending'
  const sendLabel = task.do === 'reply' ? 'Send reply' : task.do === 'review' ? 'Post review' : task.do === 'book' ? 'Book it' : 'Archive'
  const row = isSending
    ? buttons([['auto:check:none', 'Sending…', 'outline']], pad, y, hover, isCompact ? 36 : 44, isCompact ? 14.5 : 16)
    : buttons([['auto:check:send', sendLabel, 'primary'], ...(task.do === 'reply' ? [['auto:check:edit', 'Edit first', 'outline'] as [string, string, Look]] : []),
      ['auto:check:skip', 'Don\'t send', 'focus']], pad + 3, y, hover, isCompact ? 36 : 44, isCompact ? 14.5 : 16)
  body += row.body
  if (row.endX + 150 < width - pad) {
    body += `<text x="${row.endX + 18}" y="${y + (isCompact ? 23 : 27)}" ${SANS} font-size="14" style="fill:${c('muted')}">Held by Switchboard</text>`
  }
  y += isCompact ? 36 : 44
  const height = y + pad
  return { svg: bandPicture(width, height, frame(width, height, isCompact ? 16 : 20) + body), height, parts: isSending ? [] : row.parts }
}

// ---- The Auto band row (Inbox session) -------------------------------------------------------------

/** "AUTO · ● 1 running · 1 waiting · 7 rules on · Pause all". */
export function autoRowSvg(width: number, state: AutoState, text: string, hover: string): { svg: string; height: number; parts: Part[] } {
  const height = 34
  const parts: Part[] = []
  let body = eyebrow('Auto', 4, 22, state.isPaused ? c('muted') : c('orange'), 12)
  const x = 4 + 14 + textWidth('AUTO', 12, true) * 1.15 + 12
  const action: [string, string] = state.isPaused ? ['auto:resume', 'Resume'] : ['auto:pause', 'Pause all']
  const actionW = textWidth(action[1], 14, true) + 22
  const openW = textWidth('Open Auto', 14, true) + 22
  const textKey = 'auto:open'
  parts.push({ key: textKey, leftPx: x - 4, widthPx: width - x - actionW - openW - 20, topPx: 2, heightPx: 30 })
  body += `<text x="${x}" y="${22}" ${SANS} font-size="14" style="fill:${hover === textKey ? c('ink') : c('muted')}">${esc(fit(text, width - x - actionW - openW - 28, 14))}</text>`
  const openX = width - actionW - openW - 8
  parts.push({ key: 'auto:open', leftPx: openX, widthPx: openW, topPx: 2, heightPx: 30 })
  parts.push({ key: action[0], leftPx: width - actionW - 2, widthPx: actionW, topPx: 2, heightPx: 30 })
  body += `<rect x="${openX + 0.5}" y="2.5" width="${openW - 1}" height="29" rx="10" style="fill:${hover === 'auto:open' ? c('card2') : 'none'};stroke:${c('line2')}"/>` +
    `<text x="${openX + openW / 2}" y="22" text-anchor="middle" ${SANS} font-size="14" font-weight="600" style="fill:${c('ink')}">Open Auto</text>` +
    `<rect x="${width - actionW - 1.5}" y="2.5" width="${actionW - 1}" height="29" rx="10" style="fill:${hover === action[0] ? c('card2') : 'none'};stroke:${c('line2')}"/>` +
    `<text x="${width - 2 - actionW / 2}" y="22" text-anchor="middle" ${SANS} font-size="14" font-weight="600" style="fill:${c('ink')}">${action[1]}</text>`
  return { svg: bandPicture(width, height, body), height, parts }
}

// ---- The Auto pane (screen 7) ----------------------------------------------------------------------

/** Right now: the counts, today's cost, the Auto mode switch and Pause all. */
export function rightNowSvg(width: number, state: AutoState, now: number, hover: string): { svg: string; height: number; parts: Part[] } {
  const pad = 18
  const height = 150
  const parts: Part[] = []
  let body = cardBox(width, height) + tile(pad, pad, 50, 'bolt', 'orange', 'orangeSoft') +
    eyebrow('Right now', pad + 66, pad + 14, c('orange'), 12.5) +
    `<text x="${pad + 66}" y="${pad + 40}" ${SERIF} font-size="21" font-weight="500" style="fill:${c('ink')}">${esc(fit(rightNowText(state), width - pad * 2 - 66, 21))}</text>` +
    `<text x="${pad + 66}" y="${pad + 62}" ${SANS} font-size="14.5" style="fill:${c('muted')}">${doneToday(state, now)} done today · $${state.costToday.toFixed(2)} on Haiku 4.5</text>` +
    `<rect x="${pad}" y="${pad + 80}" width="${width - pad * 2}" height="1" style="fill:${c('line')}"/>`
  const y = pad + 92
  body += `<text x="${pad}" y="${y + 21}" ${SANS} font-size="15" font-weight="700" style="fill:${c('ink')}">Auto mode</text>`
  const togX = pad + textWidth('Auto mode', 15, true) + 14
  parts.push({ key: 'auto:toggle', leftPx: togX - 4, widthPx: 50, topPx: y + 2, heightPx: 30 })
  body += `<rect x="${togX}" y="${y + 5}" width="42" height="24" rx="12" style="fill:${state.isOn ? c('orange') : c('off')}"/>` +
    `<circle cx="${state.isOn ? togX + 30 : togX + 12}" cy="${y + 17}" r="9" fill="#FFFFFF"/>`
  const action: [string, string] = state.isPaused ? ['auto:resume', 'Resume'] : ['auto:pause', 'Pause all']
  const w = textWidth(action[1], 13.5, true) + 26
  parts.push({ key: action[0], leftPx: width - pad - w, widthPx: w, topPx: y + 2, heightPx: 30 })
  body += `<rect x="${width - pad - w + 0.5}" y="${y + 2.5}" width="${w - 1}" height="29" rx="10" style="fill:${hover === action[0] ? c('card2') : 'none'};stroke:${c('line2')}"/>` +
    `<text x="${width - pad - w / 2}" y="${y + 22}" text-anchor="middle" ${SANS} font-size="13.5" font-weight="600" style="fill:${c('ink')}">${action[1]}</text>`
  return { svg: panel(width, height, body), height, parts }
}

/** Running tasks with Stop, waiting ones with Check. */
export function tasksSvg(width: number, tasks: readonly AutoTask[], now: number, hover: string): { svg: string; height: number; parts: Part[] } {
  const pad = 18
  const rowH = 58
  const shown = tasks.slice(0, 8)
  const height = shown.length ? shown.length * rowH + 16 : 60
  const parts: Part[] = []
  let body = cardBox(width, height)
  if (!shown.length) {
    body += `<text x="${pad}" y="36" ${SANS} font-size="14.5" style="fill:${c('muted')}">Nothing running or waiting. New messages that match a rule show here.</text>`
    return { svg: panel(width, height, body), height, parts }
  }
  shown.forEach((task, index) => {
    const top = 8 + index * rowH
    if (index) body += `<rect x="${pad}" y="${top}" width="${width - pad * 2}" height="1" style="fill:${c('line')}"/>`
    const look = DO_LOOK[task.do]
    body += tile(pad, top + 15, 28, look.icon, look.fg, look.bg)
    const isWaiting = task.state === 'waiting'
    const key = isWaiting ? `auto:check:${task.id}` : `auto:stop:${task.id}`
    const label = isWaiting ? 'Check' : 'Stop'
    const w = textWidth(label, 13.5, true) + 26
    const x0 = pad + 40
    const textW = width - pad - w - 12 - x0
    body += `<text x="${x0}" y="${top + 25}" ${SANS} font-size="14.5" font-weight="700" style="fill:${c('ink')}">${esc(fit(task.title, textW, 14.5, true))}</text>`
    if (isWaiting) {
      body += `<text x="${x0}" y="${top + 45}" ${SANS} font-size="13" style="fill:${c('muted')}">${esc(fit(`${task.ruleName} · Ask first · ${waitingFor(task, now)}`, textW, 13))}</text>`
    } else {
      // A running task has no measurable progress: a moving stripe on the track says it's alive.
      const trackW = Math.max(60, textW - 90)
      const phase = ((now / 1000) % 4) / 4
      body += `<rect x="${x0}" y="${top + 36}" width="${trackW}" height="6" rx="3" style="fill:${c('track')}"/>` +
        `<rect x="${x0 + (trackW * 0.7) * phase}" y="${top + 36}" width="${trackW * 0.3}" height="6" rx="3" style="fill:${c('orange')}"/>` +
        `<text x="${x0 + trackW + 10}" y="${top + 43}" ${SANS} font-size="12.5" style="fill:${c('muted')}">${task.state === 'sending' ? 'sending' : task.do === 'reply' ? 'drafting' : 'working'}</text>`
    }
    parts.push({ key, leftPx: width - pad - w, widthPx: w, topPx: top + 14, heightPx: 30 })
    const fill = isWaiting ? c('prim') : hover === key ? c('card2') : 'none'
    body += `<rect x="${width - pad - w + 0.5}" y="${top + 14.5}" width="${w - 1}" height="29" rx="10" style="fill:${fill};stroke:${isWaiting ? c('prim') : c('line2')}"/>` +
      `<text x="${width - pad - w / 2}" y="${top + 34}" text-anchor="middle" ${SANS} font-size="13.5" font-weight="600" style="fill:${isWaiting ? c('onprim') : c('ink')}">${label}</text>`
  })
  return { svg: panel(width, height, body), height, parts }
}

/** The rules, highest first: who or what, what it does, and its Ask first / Auto / Off pill (click to switch). */
export function rulesSvg(width: number, rules: readonly AutoRule[], hover: string): { svg: string; height: number; parts: Part[] } {
  const pad = 18
  const rowH = 46
  const height = rules.length ? rules.length * rowH + 8 : 60
  const parts: Part[] = []
  let body = cardBox(width, height)
  if (!rules.length) {
    body += `<text x="${pad}" y="36" ${SANS} font-size="14.5" style="fill:${c('muted')}">No rules yet. Type /sb-auto and say what to do.</text>`
    return { svg: panel(width, height, body), height, parts }
  }
  rules.forEach((rule, index) => {
    const top = 4 + index * rowH
    if (index) body += `<rect x="${pad}" y="${top}" width="${width - pad * 2}" height="1" style="fill:${c('line')}"/>`
    const look = DO_LOOK[rule.pairs[0]?.do ?? 'reply']
    body += rule.person ? avatar(pad, top + 9, 28, rule.person) : tile(pad, top + 9, 28, look.icon, look.fg, look.bg)
    const label = !rule.isOn ? 'Off' : rule.mode === 'auto' ? 'Auto' : 'Ask first'
    const tone: PillTone = !rule.isOn ? 'muted' : rule.mode === 'auto' ? 'green' : 'amber'
    const pw = pillWidth(label, 12.5)
    const key = `auto:mode:${rule.id}`
    parts.push({ key, leftPx: width - pad - pw - 2, widthPx: pw + 4, topPx: top + 9, heightPx: 28 })
    const textW = width - pad * 2 - 40 - pw - 12
    const name = fit(rule.name, textW * 0.55, 14.5, true)
    body += `<text x="${pad + 40}" y="${top + 28}" ${SANS} font-size="14.5" xml:space="preserve"><tspan font-weight="700" style="fill:${c('ink')}">${esc(name)}</tspan>` +
      `<tspan font-size="13" style="fill:${c('muted')}">  · ${esc(fit(ruleSummary(rule), textW - textWidth(name, 14.5, true) - 16, 13))}</tspan></text>` +
      (hover === key ? `<rect x="${width - pad - pw - 2}" y="${top + 9}" width="${pw + 4}" height="28" rx="14" style="fill:${c('line')}"/>` : '') +
      pill(width - pad, top + 23, label, tone, 12.5)
  })
  return { svg: panel(width, height, body), height, parts }
}

/** Today: time, what was done, and Undo where it can. */
export function logSvg(width: number, log: readonly AutoLogEntry[], hover: string): { svg: string; height: number; parts: Part[] } {
  const rowH = 36
  const shown = log.slice(0, 20)
  const height = shown.length ? shown.length * rowH : 36
  const parts: Part[] = []
  let body = ''
  if (!shown.length) {
    body += `<text x="4" y="22" ${SANS} font-size="14.5" style="fill:${c('muted')}">Nothing done yet today.</text>`
    return { svg: panel(width, height, body), height, parts }
  }
  shown.forEach((entry, index) => {
    const top = index * rowH
    const canUndo = !!entry.actionId && UNDOABLE.has(entry.undo) && !entry.isUndone
    const key = `auto:undo:${entry.actionId}`
    const right = canUndo ? 'Undo' : entry.isUndone ? 'Undone' : ''
    const w = right ? textWidth(right, 13.5, true) + 18 : 0
    body += `<text x="4" y="${top + 23}" ${SANS} font-size="13" style="fill:${c('muted')}">${clock(entry.at)}</text>` +
      `<text x="56" y="${top + 23}" ${SANS} font-size="14.5" style="fill:${entry.isUndone ? c('muted') : c('ink')}">${esc(fit(entry.text, width - 56 - w - 12, 14.5))}</text>`
    if (canUndo) {
      parts.push({ key, leftPx: width - w - 2, widthPx: w, topPx: top + 4, heightPx: 28 })
      body += (hover === key ? `<rect x="${width - w - 2}" y="${top + 4}" width="${w}" height="28" rx="9" style="fill:${c('card2')}"/>` : '') +
        `<text x="${width - 2 - w / 2}" y="${top + 23}" text-anchor="middle" ${SANS} font-size="13.5" font-weight="600" style="fill:${c('orange')}">Undo</text>`
    } else if (right) {
      body += `<text x="${width - 4}" y="${top + 23}" text-anchor="end" ${SANS} font-size="13" style="fill:${c('faint')}">${right}</text>`
    }
  })
  return { svg: panel(width, height, body), height, parts }
}
