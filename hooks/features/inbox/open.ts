// The Inbox pane's own pieces (screens 3 and 4, in any session): the toolbar, problem banners, the
// demo note, plain rows with the open one marked, and the open message under its row: the message,
// then its reply (Slack, Gmail) or its actions (Calendar, GitHub, Jira). Plain TypeScript, no engine.

import { SANS, SERIF, c, esc, eyebrow, fit, icon, textWidth } from '../../ui/theme.ts'
import { panel, pill, type Part, type PillTone } from '../../ui/kit.ts'
import { IMPROVE_PRESETS } from './drafts.ts'
import { SOURCE_NAME, ago, canSend, replyText, type InboxItem, type InboxReply, type ReplyOption } from './model.ts'
import { ROW_H, buttons, cardBox, lines, row, sourceBadge, wrap, type Look, type RowMark } from './pictures.ts'

// ---- The toolbar, banners, notes ---------------------------------------------------------------------

/** Mark all read at the left; Auto and Sources at the right. */
export function toolbarSvg(width: number, unread: number, hasAuto: boolean, hover: string): { svg: string; height: number; parts: Part[] } {
  const height = 38
  const parts: Part[] = []
  let body = ''
  if (unread) {
    const w = textWidth('Mark all read', 14.5, true) + 20
    parts.push({ key: 'inbox:allread', leftPx: 0, widthPx: w, topPx: 2, heightPx: 34 })
    body += (hover === 'inbox:allread' ? `<rect x="0" y="2" width="${w}" height="34" rx="10" style="fill:${c('card2')}"/>` : '') +
      `<text x="10" y="24" ${SANS} font-size="14.5" font-weight="600" style="fill:${c('muted')}">Mark all read</text>`
  }
  let right = width
  for (const [key, label, name] of [['inbox:sources', 'Sources', 'sliders'], ...(hasAuto ? [['auto:open', 'Auto', 'bolt']] : [])] as [string, string, string][]) {
    const w = textWidth(label, 14.5, true) + 46
    right -= w
    parts.push({ key, leftPx: right, widthPx: w, topPx: 2, heightPx: 34 })
    body += `<rect x="${right + 0.5}" y="2.5" width="${w - 1}" height="33" rx="11" style="fill:${hover === key ? c('card2') : 'none'};stroke:${c('line2')}"/>` +
      icon(name, right + 12, 10, 18, c('muted')) +
      `<text x="${right + 36}" y="24" ${SANS} font-size="14.5" font-weight="600" style="fill:${c('ink')}">${label}</text>`
    right -= 8
  }
  return { svg: panel(width, height, body), height, parts }
}

export type Problem = { source: string; state: string; message: string }

/** One line per source that needs you: what's wrong, and Resume or Fix. */
export function bannersSvg(width: number, problems: readonly Problem[], hover: string): { svg: string; height: number; parts: Part[] } {
  const rowH = 46
  const height = problems.length * rowH
  const parts: Part[] = []
  let body = ''
  problems.forEach((problem, index) => {
    const top = index * rowH
    const isPaused = problem.state === 'paused'
    const tone = problem.state === 'auth' || problem.state === 'error' ? 'red' : 'amber'
    const isPermission = problem.state === 'permission'
    const label = isPaused ? 'Resume' : isPermission ? 'Allow' : 'Fix'
    // Each row its own key (one shared key lit every Fix and Sources together): an error checks again,
    // a refused read asks for the person's OK, sign-in and setup open Sources.
    const key = isPaused ? `inbox:resume:${problem.source}` : isPermission ? `inbox:allow:${problem.source}`
      : problem.state === 'error' ? `inbox:recheck:${problem.source}` : `inbox:fix:${problem.source}`
    const w = textWidth(label, 14, true) + 26
    parts.push({ key, leftPx: width - w - 8, widthPx: w, topPx: top + 7, heightPx: 32 })
    const name = SOURCE_NAME[problem.source as keyof typeof SOURCE_NAME] ?? problem.source
    body += `<rect x="0.5" y="${top + 2.5}" width="${width - 1}" height="${rowH - 5}" rx="12" style="fill:${c(tone === 'red' ? 'redSoft' : 'amberSoft')}"/>` +
      `<circle cx="16" cy="${top + 23}" r="4.5" style="fill:${c(tone)}"/>` +
      `<text x="30" y="${top + 28}" ${SANS} font-size="14.5" xml:space="preserve"><tspan font-weight="700" style="fill:${c('ink')}">${esc(name)}</tspan>` +
      `<tspan style="fill:${c('muted')}">  ${esc(fit(problem.message || problem.state, width - 60 - w - textWidth(name, 14.5, true), 14.5))}</tspan></text>` +
      `<rect x="${width - w - 7.5}" y="${top + 7.5}" width="${w - 1}" height="31" rx="10" style="fill:${hover === key ? c('card') : 'none'};stroke:${c('line2')}"/>` +
      `<text x="${width - 8 - w / 2}" y="${top + 28}" text-anchor="middle" ${SANS} font-size="14" font-weight="600" style="fill:${c('ink')}">${label}</text>`
  })
  return { svg: panel(width, height, body), height, parts }
}

/** "Demo: made-up messages, nothing is really sent." and Use my accounts. */
export function demoSvg(width: number, hover: string): { svg: string; height: number; parts: Part[] } {
  const height = 40
  const label = 'Use my accounts'
  const w = textWidth(label, 14, true) + 26
  const key = 'inbox:demo-off'
  return {
    height, parts: [{ key, leftPx: width - w, widthPx: w, topPx: 4, heightPx: 32 }],
    svg: panel(width, height, `<text x="4" y="25" ${SANS} font-size="14.5" style="fill:${c('muted')}">${esc(fit('Demo: made-up messages, nothing is really sent.', width - w - 16, 14.5))}</text>` +
      `<rect x="${width - w + 0.5}" y="4.5" width="${w - 1}" height="31" rx="10" style="fill:${hover === key ? c('card2') : 'none'};stroke:${c('line2')}"/>` +
      `<text x="${width - w / 2}" y="25" text-anchor="middle" ${SANS} font-size="14" font-weight="600" style="fill:${c('ink')}">${label}</text>`),
  }
}

/** Nothing in the list: a check and "All caught up" (or what the watcher is doing). */
export function emptySvg(width: number, text: string): { svg: string; height: number } {
  const height = 96
  return {
    height,
    svg: panel(width, height, icon('check', width / 2 - 12, 18, 24, c('green')) +
      `<text x="${width / 2}" y="70" text-anchor="middle" ${SANS} font-size="15" style="fill:${c('muted')}">${esc(text)}</text>`),
  }
}

// ---- Rows ------------------------------------------------------------------------------------------

/** Plain rows (screen 4's pane); the open one outlined with an "open" pill. */
export function rowsSvg(width: number, items: readonly InboxItem[], markOf: (item: InboxItem) => RowMark, openId: string, hover: string):
  { svg: string; height: number; parts: Part[] } {
  const parts: Part[] = []
  let body = ''
  items.forEach((item, index) => {
    const y = index * ROW_H
    const isOpen = item.id === openId
    parts.push({ key: `inbox:open:${item.id}`, leftPx: 0, widthPx: width, topPx: y, heightPx: ROW_H })
    if (isOpen) body += `<rect x="0.5" y="${y + 2.5}" width="${width - 1}" height="${ROW_H - 5}" rx="10" style="fill:${c('tealSoft')};stroke:${c('teal')}"/>`
    body += row(0, width, y, item, isOpen ? { text: 'open', tone: 'teal' } : markOf(item), isOpen ? '' : hover, !isOpen && (item.isRead || item.level === 'quiet'))
  })
  const height = Math.max(1, items.length) * ROW_H
  return { svg: panel(width, height, body), height, parts }
}

// ---- The open message ------------------------------------------------------------------------------

const KIND_WORDS: Record<string, string> = {
  dm: 'Direct message', mention: 'Mentioned you', thread: 'In your thread', mail: 'Email', meeting: 'Meeting', invite: 'Invite',
  review_request: 'Review requested', ci_failed: 'CI failed', assigned: 'Assigned to you', comment: 'Comment', message: 'Message',
}

const LINK_WORDS: Record<string, string> = { slack: 'Open in Slack', gmail: 'Open in Gmail', calendar: 'Open in Calendar', github: 'Open on GitHub', jira: 'Open in Jira' }

const hhmm = (iso: string) => {
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return ''
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** The line under the title: where it is and what state it's in. */
export function detailLine(item: InboxItem, reply: InboxReply | null): string {
  const d = item.details
  const list = (key: string) => (Array.isArray(d[key]) ? d[key] as string[] : [])
  if (item.source === 'jira') return [item.from.handle || item.id.replace(/^jira:/, ''), reply?.status || String(d.status ?? ''), String(d.priority ?? '')].filter(Boolean).join(' · ')
  if (item.source === 'github') return [String(d.repo ?? ''), String(d.reason ?? '').replace(/_/g, ' ')].filter(Boolean).join(' · ')
  if (item.source === 'calendar') {
    const people = list('attendees')
    return [d.starts_at ? `${hhmm(String(d.starts_at))}${d.ends_at ? ` – ${hhmm(String(d.ends_at))}` : ''}` : '', people.length ? `${people.length} people` : ''].filter(Boolean).join(' · ')
  }
  if (item.source === 'slack') return d.channel_name ? `#${d.channel_name}` : KIND_WORDS[item.kind] ?? ''
  return [item.from.email, item.files.length ? `${item.files.length} attachment${item.files.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')
}

/** The message: who, what kind, when; its title, details, the whole text, attachments, and a link out. */
export function messageSvg(width: number, item: InboxItem, reply: InboxReply | null, now: number, hover: string, maxLines = 16):
  { svg: string; height: number; parts: Part[] } {
  const pad = 18
  const inner = width - pad * 2
  const parts: Part[] = []
  const badge = sourceBadge(pad, pad + 12, item.source)
  const when = `${ago(item.receivedAt, now)}${ago(item.receivedAt, now) === 'now' ? '' : ' ago'}`
  const closeKey = 'reply:close'
  parts.push({ key: closeKey, leftPx: width - pad - 30, widthPx: 32, topPx: pad - 4, heightPx: 32 })
  const kind = KIND_WORDS[item.kind] ?? ''
  const nameW = textWidth(item.from.name, 15, true)
  let body = badge.svg +
    `<text x="${pad + badge.width + 12}" y="${pad + 17}" ${SANS} font-size="15" xml:space="preserve"><tspan font-weight="700" style="fill:${c('ink')}">${esc(fit(item.from.name, inner * 0.45, 15, true))}</tspan>` +
    `<tspan style="fill:${c('muted')}">  ${esc(fit(`${kind ? `${kind} · ` : ''}${when}`, inner - badge.width - 60 - Math.min(nameW, inner * 0.45), 14))}</tspan></text>` +
    (hover === closeKey ? `<rect x="${width - pad - 30}" y="${pad - 4}" width="32" height="32" rx="9" style="fill:${c('card2')}"/>` : '') +
    icon('close', width - pad - 24, pad + 2, 20, c('muted'))
  let y = pad + 40
  const title = item.source === 'slack' ? '' : item.title
  if (title) {
    const titleLines = lines(title, inner, 19, 2)
    titleLines.forEach((line, index) => { body += `<text x="${pad}" y="${y + 18 + index * 25}" ${SERIF} font-size="19" font-weight="500" style="fill:${c('ink')}">${esc(line)}</text>` })
    y += titleLines.length * 25 + 6
  }
  const detail = detailLine(item, reply)
  if (detail) {
    body += `<text x="${pad}" y="${y + 14}" ${SANS} font-size="14" style="fill:${c('muted')}">${esc(fit(detail, inner, 14))}</text>`
    y += 24
  }
  // The text, paragraph by paragraph, at most `maxLines` lines.
  const text = (reply?.full || item.body || item.title).replace(/\r/g, '')
  const all: string[] = []
  for (const paragraph of text.split(/\n/)) {
    if (!paragraph.trim()) {
      if (all.length && all[all.length - 1] !== '') all.push('')
      continue
    }
    all.push(...wrap(paragraph.trim(), inner, 15))
  }
  while (all.length && all[all.length - 1] === '') all.pop()
  const shown = all.slice(0, maxLines)
  if (all.length > maxLines) shown[maxLines - 1] = `${fit(shown[maxLines - 1] ?? '', inner - 20, 15)} …`
  y += 6
  shown.forEach((line, index) => {
    if (line) body += `<text x="${pad}" y="${y + 16 + index * 22}" ${SANS} font-size="15" style="fill:${c('ink')}">${esc(line)}</text>`
  })
  y += shown.length * 22 + 8
  if (item.files.length) {
    body += icon('file', pad, y + 2, 17, c('muted')) +
      `<text x="${pad + 24}" y="${y + 15}" ${SANS} font-size="14" style="fill:${c('muted')}">${esc(fit(item.files.join(', '), inner - 24, 14))}</text>`
    y += 26
  }
  if (/^https:\/\//.test(item.url)) {
    const label = `${LINK_WORDS[item.source] ?? 'Open'} ↗`
    const w = textWidth(label, 14, true) + 12
    parts.push({ key: 'inbox:link', leftPx: pad - 6, widthPx: w, topPx: y, heightPx: 28 })
    body += (hover === 'inbox:link' ? `<rect x="${pad - 6}" y="${y}" width="${w}" height="28" rx="8" style="fill:${c('card2')}"/>` : '') +
      `<text x="${pad}" y="${y + 19}" ${SANS} font-size="14" font-weight="600" style="fill:${c('orange')}">${esc(label)}</text>`
    y += 30
  }
  const height = y + pad - 6
  return { svg: panel(width, height, cardBox(width, height) + body), height, parts }
}

// ---- The reply (Slack, Gmail) ----------------------------------------------------------------------

const OPTIONS: [ReplyOption, string, string][] = [
  ['short', 'Short', '1 sentence'], ['detailed', 'Detailed', 'covers each point'], ['ask', 'Ask a question', 'ask before committing'],
]

function draftLine(reply: InboxReply): string {
  if (reply.phase === 'drafting') return 'Drafting three replies…'
  if (reply.phase === 'error' && !replyText(reply)) return reply.error || "Couldn't draft a reply."
  return replyText(reply) ? `“${replyText(reply)}”` : 'No reply yet. Use Edit to write one.'
}

/** Screen 4's reply: who it goes to, the draft, Reply all (Gmail), and the three ways to reply. */
export function replySvg(width: number, item: InboxItem, reply: InboxReply, hover: string): { svg: string; height: number; parts: Part[] } {
  const pad = 18
  const parts: Part[] = []
  const x0 = pad + 46 + 16
  const textW = width - x0 - pad
  const said = reply.edited ? (reply.improve === 'off' && reply.improved === reply.edited ? 'Improved' : 'Edited by you') : item.isExcluded ? 'Written by you' : 'Claude drafted'
  let body = `<rect x="${pad}" y="${pad}" width="46" height="46" rx="14" style="fill:${c('tealSoft')}"/>` + icon('send', pad + 12, pad + 11, 22, c('teal')) +
    eyebrow(`Reply to ${fit(item.from.name, textW - 140, 12.5, true)}`, x0, pad + 13, c('teal'), 12.5) +
    `<text x="${width - pad}" y="${pad + 13}" text-anchor="end" ${SANS} font-size="14" style="fill:${c('muted')}">${said}</text>`
  const quote = lines(draftLine(reply), textW, 17, 8)
  quote.forEach((line, index) => {
    body += `<text x="${x0}" y="${pad + 40 + index * 23}" ${SERIF} font-size="17" font-weight="500" style="fill:${reply.phase === 'drafting' ? c('muted') : c('ink')}">${esc(line)}</text>`
  })
  let y = pad + 40 + (quote.length - 1) * 23 + 24
  const where = reply.target ? `Goes to ${reply.target}, as you` : 'Finding where it goes…'
  if (item.source === 'gmail' && reply.phase !== 'drafting') {
    const label = reply.replyAll ? '✓ Reply all' : 'Reply all'
    const w = textWidth(label, 13.5, true) + 24
    parts.push({ key: 'reply:all', leftPx: width - pad - w, widthPx: w, topPx: y - 19, heightPx: 28 })
    body += `<rect x="${width - pad - w + 0.5}" y="${y - 18.5}" width="${w - 1}" height="27" rx="13.5" style="fill:${reply.replyAll ? c('tealSoft') : hover === 'reply:all' ? c('card2') : 'none'};stroke:${reply.replyAll ? c('teal') : c('line2')}"/>` +
      `<text x="${width - pad - w / 2}" y="${y}" text-anchor="middle" ${SANS} font-size="13.5" font-weight="600" style="fill:${reply.replyAll ? c('teal') : c('ink')}">${label}</text>`
    body += `<text x="${x0}" y="${y}" ${SANS} font-size="14" style="fill:${c('muted')}">${esc(fit(where, textW - w - 10, 14))}</text>`
  } else {
    body += `<text x="${x0}" y="${y}" ${SANS} font-size="14" style="fill:${c('muted')}">${esc(fit(where, textW, 14))}</text>`
  }
  y += 14
  if (reply.note) {
    body += `<text x="${x0}" y="${y + 6}" ${SANS} font-size="13.5" style="fill:${c('amber')}">${esc(fit(reply.note, textW, 13.5))}</text>`
    y += 20
  }
  if (reply.phase === 'error' && reply.error && !item.isExcluded) {
    const w = textWidth('Retry', 13.5, true) + 24
    parts.push({ key: 'reply:retry', leftPx: width - pad - w, widthPx: w, topPx: y - 2, heightPx: 28 })
    body += `<text x="${x0}" y="${y + 16}" ${SANS} font-size="13.5" style="fill:${c('red')}">${esc(fit(reply.error, textW - w - 10, 13.5))}</text>` +
      `<rect x="${width - pad - w + 0.5}" y="${y - 1.5}" width="${w - 1}" height="27" rx="10" style="fill:${hover === 'reply:retry' ? c('card2') : 'none'};stroke:${c('line2')}"/>` +
      `<text x="${width - pad - w / 2}" y="${y + 17}" text-anchor="middle" ${SANS} font-size="13.5" font-weight="600" style="fill:${c('ink')}">Retry</text>`
    y += 32
  }
  if (!item.isExcluded && reply.drafts.short) {
    body += `<text x="${pad}" y="${y + 18}" ${SANS} font-size="12.5" font-weight="700" letter-spacing="1.1" style="fill:${c('muted')}">HOW TO REPLY</text>`
    y += 28
    for (const [option, label, note] of OPTIONS) {
      const key = `reply:opt:${option}`
      const isOn = reply.option === option && !reply.edited
      parts.push({ key, leftPx: pad, widthPx: width - pad * 2, topPx: y, heightPx: 38 })
      const shown = option === 'ask' ? reply.thirdLabel : label
      body += `<rect x="${pad + 0.5}" y="${y + 0.5}" width="${width - pad * 2 - 1}" height="37" rx="12" style="fill:${isOn ? c('tealSoft') : hover === key ? c('card2') : c('card')};stroke:${isOn ? c('teal') : c('line')}"/>` +
        `<circle cx="${pad + 20}" cy="${y + 19}" r="6" style="fill:${isOn ? c('teal') : 'none'};stroke:${isOn ? c('teal') : c('line2')}" stroke-width="1.5"/>` +
        `<text x="${pad + 38}" y="${y + 24}" ${SANS} font-size="15" style="fill:${c('ink')}">${esc(shown)}</text>` +
        `<text x="${width - pad - 14}" y="${y + 24}" text-anchor="end" ${SANS} font-size="14" style="fill:${c('muted')}">${esc(note)}</text>`
      y += 44
    }
    y -= 6
  }
  const height = y + pad
  return { svg: panel(width, height, cardBox(width, height) + body), height, parts }
}

/** A row of buttons, as a picture of its own. */
export function actionRow(width: number, list: readonly [string, string, Look][], hover: string, note = ''): { svg: string; height: number; parts: Part[] } {
  const row = buttons(list, 0, width, 1, hover, 40, 14.5)
  const fits = !!note && row.endX + textWidth(note, 14) + 16 <= width
  const body = row.body + (fits ? `<text x="${width - 2}" y="${row.bottom - 15}" text-anchor="end" ${SANS} font-size="14" style="fill:${c('muted')}">${esc(note)}</text>` : '')
  const height = row.bottom + 3
  return { svg: panel(width, height, body), height, parts: row.parts }
}

/** Under the reply: Send reply, Improve, Edit, Save draft, Skip; the countdown with Undo; Sent; or why it failed. */
export function replyActionsSvg(width: number, item: InboxItem, reply: InboxReply, now: number, hover: string): { svg: string; height: number; parts: Part[] } {
  if (reply.phase === 'countdown') {
    const left = Math.max(0, reply.sendAt - now)
    const seconds = Math.max(1, Math.ceil(left / 1000))
    const share = 1 - left / 10_000
    const w = textWidth('Undo', 14.5, true) + 34
    const barW = width - w - 16
    return {
      height: 48, parts: [{ key: 'reply:undo', leftPx: width - w, widthPx: w, topPx: 4, heightPx: 40 }],
      svg: panel(width, 48, `<text x="2" y="17" ${SANS} font-size="14" style="fill:${c('muted')}">${esc(fit(`Sending to ${reply.target} in ${seconds} s`, barW, 14))}</text>` +
        `<rect x="2" y="28" width="${barW}" height="6" rx="3" style="fill:${c('track')}"/>` +
        `<rect x="2" y="28" width="${(barW * Math.min(1, Math.max(0, share))).toFixed(1)}" height="6" rx="3" style="fill:${c('orange')}"/>` +
        `<rect x="${width - w + 0.5}" y="4.5" width="${w - 1}" height="39" rx="11" style="fill:${c('prim')}"/>` +
        `<text x="${width - w / 2}" y="29" text-anchor="middle" ${SANS} font-size="14.5" font-weight="600" style="fill:${c('onprim')}">Undo</text>`),
    }
  }
  if (reply.phase === 'sending') return actionRow(width, [['reply:none', 'Sending…', 'outline']], '')
  if (reply.phase === 'sent') {
    const list: [string, string, Look][] = [...(reply.undo === 'slack_delete' ? [['reply:delete', 'Delete from Slack', 'outline'] as [string, string, Look]] : []), ['reply:close', 'Done', 'text']]
    const row = buttons(list, 150, width, 1, hover, 40, 14.5)
    return {
      height: 44, parts: row.parts,
      svg: panel(width, 44, `<rect x="0.5" y="4.5" width="138" height="35" rx="11" style="fill:${c('greenSoft')}"/>` + icon('check', 12, 12, 18, c('green')) +
        `<text x="38" y="27" ${SANS} font-size="14.5" font-weight="700" style="fill:${c('green')}">Sent as you</text>` + row.body),
    }
  }
  if (reply.phase === 'failed') {
    const said = lines(reply.error || 'Not sent.', width - 4, 14, 3)
    const list: [string, string, Look][] = [...(reply.failCode === 'original_edited' ? [['reply:anyway', 'I re-read it · send', 'primary'] as [string, string, Look]] : []), ['reply:back', 'Back to reply', 'outline']]
    const top = said.length * 20 + 8
    const row = buttons(list, 0, width, top, hover, 40, 14.5)
    let body = said.map((line, index) => `<text x="2" y="${16 + index * 20}" ${SANS} font-size="14" style="fill:${c('red')}">${esc(line)}</text>`).join('')
    body += row.body
    return { svg: panel(width, row.bottom + 3, body), height: row.bottom + 3, parts: row.parts }
  }
  if (reply.phase === 'drafting') return actionRow(width, [['reply:edit', 'Write it myself', 'outline'], ['reply:skip', 'Skip', 'text']], hover)
  const list: [string, string, Look][] = [
    ...(canSend(reply) ? [['reply:send', 'Send reply', 'primary'] as [string, string, Look]] : []),
    ...(!item.isExcluded && replyText(reply) ? [['reply:improve', 'Improve', 'outline'] as [string, string, Look]] : []),
    ['reply:edit', 'Edit', 'outline'],
    ...(replyText(reply) ? [['reply:draft', 'Save draft', 'outline'] as [string, string, Look]] : []),
    ['reply:skip', 'Skip', 'text'],
  ]
  return actionRow(width, list, hover, 'Undo for 10 s after sending')
}

/** Improve: four quick rewrites (and your own words in the field under it), then before and after. */
export function improveSvg(width: number, reply: InboxReply, hover: string): { svg: string; height: number; parts: Part[] } {
  const pad = 16
  const parts: Part[] = []
  let body = eyebrow('Improve the reply', pad, pad + 12, c('teal'), 12)
  let y = pad + 24
  if (reply.improve === 'choosing' || reply.improve === 'working') {
    let x = pad
    IMPROVE_PRESETS.forEach((preset, index) => {
      const key = `reply:improve:${index}`
      const w = textWidth(preset, 14, true) + 26
      if (x + w > width - pad) {
        x = pad
        y += 40
      }
      parts.push({ key, leftPx: x, widthPx: w, topPx: y, heightPx: 32 })
      body += `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="31" rx="16" style="fill:${hover === key ? c('tealSoft') : 'none'};stroke:${c('line2')}"/>` +
        `<text x="${x + w / 2}" y="${y + 21}" text-anchor="middle" ${SANS} font-size="14" font-weight="600" style="fill:${c('ink')}">${preset}</text>`
      x += w + 8
    })
    y += 40
    if (reply.improve === 'working') {
      body += `<text x="${pad}" y="${y + 14}" ${SANS} font-size="14" style="fill:${c('muted')}">Improving…</text>`
      y += 22
    }
  } else {
    const before = lines(replyText(reply), width - pad * 2, 14, 3)
    before.forEach((line, index) => {
      const w = Math.min(width - pad * 2, textWidth(line, 14))
      body += `<text x="${pad}" y="${y + 14 + index * 20}" ${SANS} font-size="14" style="fill:${c('faint')}">${esc(line)}</text>` +
        `<rect x="${pad}" y="${y + 9 + index * 20}" width="${w}" height="1" style="fill:${c('faint')}"/>`
    })
    y += before.length * 20 + 8
    const after = lines(reply.improved, width - pad * 2, 16, 8)
    after.forEach((line, index) => { body += `<text x="${pad}" y="${y + 16 + index * 22}" ${SERIF} font-size="16" font-weight="500" style="fill:${c('ink')}">${esc(line)}</text>` })
    y += after.length * 22 + 12
    const row = buttons([['reply:improve:use', 'Use this', 'primary'], ['reply:improve:again', 'Improve again', 'outline'], ['reply:improve:back', 'Back', 'text']], pad, width - pad, y, hover, 36, 14)
    body += row.body
    parts.push(...row.parts)
    y += 40
  }
  if (reply.improve !== 'done') {
    const w = textWidth('Back', 14, true) + 20
    parts.push({ key: 'reply:improve:back', leftPx: width - pad - w, widthPx: w, topPx: pad - 6, heightPx: 28 })
    body += `<text x="${width - pad - w / 2}" y="${pad + 12}" text-anchor="middle" ${SANS} font-size="14" font-weight="600" style="fill:${c('muted')}">Back</text>`
  }
  const height = y + pad - 4
  return { svg: panel(width, height, cardBox(width, height) + body), height, parts }
}

// ---- Actions for Calendar, GitHub and Jira ---------------------------------------------------------

/** Jira: the status, "Move to" one of its next statuses, Comment, Open in Jira. */
export function jiraSvg(width: number, reply: InboxReply, hover: string): { svg: string; height: number; parts: Part[] } {
  const pad = 16
  const parts: Part[] = []
  let body = `<text x="${pad}" y="${pad + 12}" ${SANS} font-size="12.5" font-weight="700" letter-spacing="1.1" style="fill:${c('muted')}">STATUS</text>`
  const status = reply.status || '…'
  const tone: PillTone = /done|closed|resolved|deploy/i.test(status) ? 'green' : /block/i.test(status) ? 'red' : /progress|review|qa|accept/i.test(status) ? 'amber' : 'muted'
  const statusW = textWidth(status, 13.5, true) + 22
  body += pill(pad + 70 + statusW, pad + 8, status, tone)
  let y = pad + 30
  if (reply.busy === 'move') {
    body += `<text x="${pad}" y="${y + 16}" ${SANS} font-size="14" style="fill:${c('muted')}">Moving…</text>`
    y += 30
  } else if (reply.choices.length) {
    body += `<text x="${pad}" y="${y + 20}" ${SANS} font-size="14" style="fill:${c('muted')}">Move to</text>`
    let x = pad + textWidth('Move to', 14) + 12
    for (const choice of reply.choices.filter(one => one.name !== reply.status)) {
      const key = `jira:move:${choice.id}`
      const w = textWidth(choice.name, 13.5, true) + 24
      if (x + w > width - pad) {
        x = pad
        y += 36
      }
      parts.push({ key, leftPx: x, widthPx: w, topPx: y + 2, heightPx: 28 })
      body += `<rect x="${x + 0.5}" y="${y + 2.5}" width="${w - 1}" height="27" rx="13.5" style="fill:${hover === key ? c('card2') : 'none'};stroke:${c('line2')}"/>` +
        `<text x="${x + w / 2}" y="${y + 21}" text-anchor="middle" ${SANS} font-size="13.5" font-weight="600" style="fill:${c('ink')}">${esc(choice.name)}</text>`
      x += w + 6
    }
    y += 40
  } else {
    body += `<text x="${pad}" y="${y + 16}" ${SANS} font-size="14" style="fill:${c('muted')}">${reply.busy === 'load' ? 'Loading where it can move…' : 'No other status is open to you here.'}</text>`
    y += 30
  }
  const row = buttons([['jira:comment', reply.busy === 'comment' ? 'Posting…' : 'Comment', 'primary'], ['inbox:link', 'Open in Jira', 'outline'], ['reply:close', 'Done', 'text']],
    pad, width - pad, y, hover, 38, 14.5)
  body += row.body
  parts.push(...row.parts)
  const height = y + 38 + pad
  return { svg: panel(width, height, cardBox(width, height) + body), height, parts }
}

/** GitHub: Open on GitHub, Ask Claude to review, Done. */
export function githubSvg(width: number, item: InboxItem, hover: string): { svg: string; height: number; parts: Part[] } {
  const list: [string, string, Look][] = [
    ...(/^https:\/\//.test(item.url) ? [['inbox:link', 'Open on GitHub', 'primary'] as [string, string, Look]] : []),
    ['gh:review', item.kind === 'ci_failed' ? 'Ask Claude why it failed' : 'Ask Claude to review', 'outline'], ['reply:close', 'Done', 'text'],
  ]
  return actionRow(width, list, hover)
}

/** Calendar: Join now (https links only), Open in Calendar, Done. */
export function calendarSvg(width: number, item: InboxItem, hover: string): { svg: string; height: number; parts: Part[] } {
  const join = String(item.details.join_url ?? '')
  const list: [string, string, Look][] = [
    ...(/^https:\/\//.test(join) ? [['cal:join', 'Join now', 'primary'] as [string, string, Look]] : []),
    ...(/^https:\/\//.test(item.url) ? [['inbox:link', 'Open in Calendar', 'outline'] as [string, string, Look]] : []),
    ['reply:close', 'Done', 'text'],
  ]
  return actionRow(width, list, hover)
}
