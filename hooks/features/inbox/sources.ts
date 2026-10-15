// The Inbox sources screen's pictures (new; the v2 canvas has none): each source with how it connects
// and its state, the setup steps for Slack and Gmail, alerts (meeting lead time, sound, Mac notification,
// quiet hours) and checking (demo, restart). Ported in substance from v1's hooks/lib/settings.tsx, drawn
// in v2's look. Plain TypeScript, no engine.

import { panel, pill, type Part, type PillTone } from '../../ui/kit.ts'
import { SANS, c, esc, fit, icon, textWidth } from '../../ui/theme.ts'
import type { InboxSetup, InboxState, Settings } from '../../../types/index.d.ts'
import { SOURCES, SOURCE_NAME, type InboxSourceId } from './model.ts'
import { buttons, cardBox, lines, sourceBadge, type Look } from './pictures.ts'

export { LEAD_CHOICES } from '../../core/store.ts'
import { LEAD_CHOICES } from '../../core/store.ts'

/** Every action on the screen (sourcesView.tsx turns picture parts into these). */
export type SourcesActions = {
  steps: (source: 'slack' | 'gmail') => void
  connectors: () => void
  openLink: (name: string) => void
  slackCode: (kind: 'user' | 'app') => void
  gmailMode: (mode: 'connector' | 'direct') => void
  gmailSignIn: () => void
  resume: (source: string) => void
  lead: (minutes: number) => void
  toggle: (what: 'sound' | 'notify' | 'quiet') => void
  demo: () => void
  restart: () => void
  back: () => void
}

export type Row = { source: InboxSourceId; dot: 'green' | 'amber' | 'red' | 'faint'; status: string; how: string; action: [string, string, Look] | null; pill: [string, PillTone] | null }

const clock = (ms: number) => {
  const date = new Date(ms)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** One line per source: how it connects, what state it's in, and the one thing to do next. */
export function rowsOf(setup: InboxSetup, state: InboxState, now: number): Row[] {
  const live = (source: string) => ['live', 'polling'].includes(state.sources[source]?.state ?? '')
  const held = (key: string) => {
    const safety = setup.safety[key]
    return safety && (safety.state === 'auth' || ((safety.state === 'paused' || safety.state === 'backoff') && safety.until > now)) ? safety : null
  }
  const out: Row[] = []
  const isDemo = state.mode === 'demo'
  for (const source of SOURCES) {
    const problem = state.sources[source]
    if (source === 'slack') {
      const direct = setup.slack.user && setup.slack.app
      const stop = held('slack')
      out.push(stop ? { source, dot: stop.state === 'auth' ? 'red' : 'amber', status: stop.state === 'auth' ? `Stopped: ${stop.reason || 'sign-in rejected'}` : `${stop.reason}. Back at ${clock(stop.until)}`, how: 'Direct', action: stop.state === 'paused' ? ['sources:resume:slack', 'Resume', 'outline'] : ['sources:steps:slack', 'Reconnect', 'outline'], pill: null }
        : direct ? { source, dot: live(source) || isDemo ? 'green' : 'amber', status: live(source) ? 'Live · instant' : 'Connected · starting', how: 'Direct · your Slack app', action: null, pill: ['Connected', 'green'] }
          : setup.slack.connector ? { source, dot: 'amber', status: "Found Claude's Slack connector; reading it isn't built yet. Connect directly for now.", how: "Claude's Slack connector", action: ['sources:steps:slack', setup.steps === 'slack' ? 'Hide steps' : 'Connect directly', 'outline'], pill: null }
            : { source, dot: 'faint', status: setup.slack.user || setup.slack.app ? 'Half done: one code to go' : 'Not connected', how: 'Your Slack app, or Claude\'s connector', action: ['sources:steps:slack', setup.steps === 'slack' ? 'Hide steps' : 'Connect', setup.steps === 'slack' ? 'outline' : 'primary'], pill: null })
    } else if (source === 'gmail') {
      const isConnector = setup.gmail.mode !== 'direct'
      const isDone = isConnector ? setup.gmail.connector : setup.gmail.signedIn
      const stop = held(isConnector ? 'gmail-connector' : 'gmail')
      out.push(stop ? { source, dot: 'amber', status: `${stop.reason}. Back at ${clock(stop.until)}`, how: isConnector ? "Claude's Gmail connector" : 'Direct', action: ['sources:resume:gmail', 'Resume', 'outline'], pill: null }
        : isDone ? { source, dot: 'green', status: isConnector ? 'Every 60 s' : 'Live', how: isConnector ? "Claude's Gmail connector" : 'Direct · Google sign-in', action: ['sources:steps:gmail', setup.steps === 'gmail' ? 'Hide' : 'Change', 'text'], pill: ['Connected', 'green'] }
          : { source, dot: 'faint', status: problem?.message ? fit(problem.message, 300, 14) : 'Not connected', how: isConnector ? "Claude's Gmail connector" : 'Direct', action: ['sources:steps:gmail', setup.steps === 'gmail' ? 'Hide steps' : 'Connect', setup.steps === 'gmail' ? 'outline' : 'primary'], pill: null })
    } else {
      const isOn = setup[source]
      out.push(isOn ? { source, dot: live(source) || isDemo ? 'green' : 'amber', status: problem?.state === 'error' ? problem.message : 'Every 60 s', how: `Claude's ${SOURCE_NAME[source]} connector`, action: null, pill: ['Connected', 'green'] }
        : { source, dot: 'faint', status: "Not on in this session: turn it on in the session's connectors", how: `Claude's ${SOURCE_NAME[source]} connector`, action: ['sources:connectors', 'Connect ↗', 'outline'], pill: null })
    }
  }
  return out
}

/** The sources card: one row each. */
export function sourcesSvg(width: number, rows: readonly Row[], hover: string): { svg: string; height: number; parts: Part[] } {
  const pad = 16
  const rowH = 64
  const parts: Part[] = []
  const height = rows.length * rowH + 8
  let body = cardBox(width, height)
  rows.forEach((row, index) => {
    const top = 4 + index * rowH
    if (index) body += `<rect x="${pad}" y="${top}" width="${width - pad * 2}" height="1" style="fill:${c('line')}"/>`
    const badge = sourceBadge(pad, top + rowH / 2, row.source)
    const x0 = pad + badge.width + 14
    let right = width - pad
    if (row.action) {
      const [key, label, look] = row.action
      const w = Math.round(textWidth(label, 14, true) * 0.92) + (look === 'text' ? 16 : 28)
      right -= w
      parts.push({ key, leftPx: right, widthPx: w, topPx: top + 15, heightPx: 34 })
      const fill = look === 'primary' ? c('prim') : hover === key ? c('card2') : 'none'
      body += `<rect x="${right + 0.5}" y="${top + 15.5}" width="${w - 1}" height="33" rx="11" style="fill:${fill};stroke:${look === 'primary' ? c('prim') : look === 'text' ? 'none' : c('line2')}"/>` +
        `<text x="${right + w / 2}" y="${top + 37}" text-anchor="middle" ${SANS} font-size="14" font-weight="600" style="fill:${look === 'primary' ? c('onprim') : look === 'text' ? c('muted') : c('ink')}">${esc(label)}</text>`
      right -= 8
    }
    if (row.pill) {
      body += pill(right, top + rowH / 2, row.pill[0], row.pill[1], 12.5)
      right -= textWidth(row.pill[0], 12.5, true) + 30
    }
    const textW = right - x0
    body += badge.svg +
      `<text x="${x0}" y="${top + 27}" ${SANS} font-size="15.5" font-weight="700" style="fill:${c('ink')}">${SOURCE_NAME[row.source]}</text>` +
      `<text x="${x0 + textWidth(SOURCE_NAME[row.source], 15.5, true) + 10}" y="${top + 27}" ${SANS} font-size="13.5" style="fill:${c('faint')}">${esc(fit(row.how, Math.max(0, textW - textWidth(SOURCE_NAME[row.source], 15.5, true) - 10), 13.5))}</text>` +
      `<circle cx="${x0 + 4}" cy="${top + 43}" r="4" style="fill:${c(row.dot === 'faint' ? 'off' : row.dot)}"/>` +
      `<text x="${x0 + 14}" y="${top + 48}" ${SANS} font-size="14" style="fill:${c('muted')}">${esc(fit(row.status, textW - 14, 14))}</text>`
  })
  return { svg: panel(width, height, body), height, parts }
}

type Step = { isDone: boolean; text: string; button: [string, string, Look] | null }

/** Numbered steps with a check when done, each with its one button. */
function stepsSvg(width: number, title: string, steps: readonly Step[], note: string, hover: string, extra: [string, string, Look][] = []): { svg: string; height: number; parts: Part[] } {
  const pad = 18
  const parts: Part[] = []
  let body = `<text x="${pad}" y="${pad + 14}" ${SANS} font-size="15.5" font-weight="700" style="fill:${c('ink')}">${esc(title)}</text>`
  let y = pad + 30
  steps.forEach((step, index) => {
    body += step.isDone ? `<circle cx="${pad + 11}" cy="${y + 11}" r="11" style="fill:${c('greenSoft')}"/>` + icon('check', pad + 3, y + 3, 16, c('green'))
      : `<circle cx="${pad + 11}" cy="${y + 11}" r="10.5" style="fill:none;stroke:${c('line2')}"/><text x="${pad + 11}" y="${y + 16}" text-anchor="middle" ${SANS} font-size="12.5" font-weight="700" style="fill:${c('muted')}">${index + 1}</text>`
    const said = lines(step.text, width - pad * 2 - 34, 14.5, 4)
    said.forEach((line, at) => { body += `<text x="${pad + 34}" y="${y + 16 + at * 20}" ${SANS} font-size="14.5" style="fill:${step.isDone ? c('muted') : c('ink')}">${esc(line)}</text>` })
    y += said.length * 20 + 8
    if (step.button) {
      const row = buttons([step.button], pad + 34, width - pad, y, hover, 34, 14)
      body += row.body
      parts.push(...row.parts)
      y += 42
    }
    y += 6
  })
  if (extra.length) {
    const row = buttons(extra, pad, width - pad, y, hover, 34, 14)
    body += row.body
    parts.push(...row.parts)
    y += 42
  }
  if (note) {
    const said = lines(note, width - pad * 2, 13.5, 3)
    said.forEach((line, at) => { body += `<text x="${pad}" y="${y + 14 + at * 19}" ${SANS} font-size="13.5" style="fill:${c('faint')}">${esc(line)}</text>` })
    y += said.length * 19 + 6
  }
  const height = y + pad - 6
  return { svg: panel(width, height, cardBox(width, height) + body), height, parts }
}

export function slackSteps(width: number, setup: InboxSetup, hover: string) {
  const busy = (kind: string) => setup.busy === `slack-${kind}`
  return stepsSvg(width, 'Connect Slack', [
    { isDone: setup.slack.user || setup.slack.app, text: 'Create the Switchboard app in Slack. Slack opens with everything filled in: pick your workspace, press Create, then Install to Workspace.', button: ['sources:link:slack_new_app', 'Open Slack ↗', 'outline'] },
    { isDone: setup.slack.user, text: 'On the app page, open "OAuth & Permissions" and copy the User OAuth Token (it starts with xoxp-). Then press:', button: ['sources:slack:user', busy('user') ? 'Checking…' : 'Paste code 1', 'primary'] },
    { isDone: setup.slack.app, text: 'Open "Basic Information", find "App-Level Tokens" and press Generate with the permission connections:write. Copy it (it starts with xapp-), then press:', button: ['sources:slack:app', busy('app') ? 'Checking…' : 'Paste code 2', 'primary'] },
  ], 'The codes go straight from your clipboard into your Mac\'s keychain. They are never shown, and the clipboard is cleared afterwards. Or skip all this: connect Slack in Claude (Settings → Connectors) and it is picked up in your next Inbox session.', hover,
  [['sources:connectors', "Use Claude's Slack connector ↗", 'text']])
}

export function gmailSteps(width: number, setup: InboxSetup, hover: string) {
  const isDirect = setup.gmail.mode === 'direct'
  if (!isDirect) {
    return stepsSvg(width, "Gmail through Claude's connector (recommended)", [
      { isDone: setup.gmail.connector, text: setup.gmail.connector ? 'Connected. New mail is checked every minute while Claude Code is open, and replies go through the same connection.' : 'Connect Gmail in Claude (Settings → Connectors). It is picked up in your next Inbox session.', button: setup.gmail.connector ? null : ['sources:connectors', 'Open Claude connectors ↗', 'primary'] },
    ], 'Want mail within seconds, even while Claude Code is closed? Connect Gmail directly instead (about 5 minutes in Google Cloud).', hover, [['sources:gmail:direct', 'Connect directly instead', 'outline']])
  }
  return stepsSvg(width, 'Connect Gmail directly', [
    { isDone: setup.gmail.client, text: 'In Google Cloud, turn on Gmail access for your project.', button: ['sources:link:gmail_api', 'Turn on Gmail access ↗', 'outline'] },
    { isDone: setup.gmail.client, text: 'Create a sign-in key: Create credentials → OAuth client ID → "Desktop app", then download it. Switchboard finds it in your Downloads folder.', button: ['sources:link:oauth_client', 'Create a sign-in key ↗', 'outline'] },
    { isDone: setup.gmail.signedIn, text: 'Sign in. Your browser opens; instant updates are set up for you.', button: ['sources:gmail:signin', setup.busy === 'gmail' ? 'Waiting for the browser…' : 'Connect Gmail', 'primary'] },
  ], '', hover, [['sources:gmail:connector', "Use Claude's Gmail connector instead", 'text']])
}

/** A switch at (x, cy). */
const toggle = (x: number, cy: number, isOn: boolean) =>
  `<rect x="${x}" y="${cy - 12}" width="42" height="24" rx="12" style="fill:${isOn ? c('orange') : c('off')}"/><circle cx="${isOn ? x + 30 : x + 12}" cy="${cy}" r="9" fill="#FFFFFF"/>`

/** Alerts: the meeting card's lead time, sound, Mac notification, quiet hours. */
export function alertsSvg(width: number, settings: Settings, hover: string): { svg: string; height: number; parts: Part[] } {
  const pad = 18
  const parts: Part[] = []
  const alerts = settings.alerts
  let body = `<text x="${pad}" y="${pad + 20}" ${SANS} font-size="15" style="fill:${c('ink')}">Meeting card</text>`
  let x = width - pad
  for (const minutes of [...LEAD_CHOICES].reverse()) {
    const label = `${minutes} min`
    const w = textWidth(label, 13.5, true) + 24
    x -= w
    const key = `sources:lead:${minutes}`
    const isOn = alerts.leadMin === minutes
    parts.push({ key, leftPx: x, widthPx: w, topPx: pad + 2, heightPx: 30 })
    body += `<rect x="${x + 0.5}" y="${pad + 2.5}" width="${w - 1}" height="29" rx="14.5" style="fill:${isOn ? c('orangeSoft') : hover === key ? c('card2') : 'none'};stroke:${isOn ? c('orange') : c('line2')}"/>` +
      `<text x="${x + w / 2}" y="${pad + 22}" text-anchor="middle" ${SANS} font-size="13.5" font-weight="600" style="fill:${isOn ? c('orange') : c('ink')}">${label}</text>`
    x -= 6
  }
  body += `<text x="${pad}" y="${pad + 38}" ${SANS} font-size="13" style="fill:${c('faint')}">before it starts</text>`
  let y = pad + 56
  const rows: ['sound' | 'notify' | 'quiet', string, string, boolean][] = [
    ['sound', 'Sound', 'For Critical messages and meetings', alerts.isSound],
    ['notify', 'Mac notification', 'Shows even when Claude is in the background', alerts.isNotify],
    ['quiet', 'Quiet hours', `${settings.quietHours.from} to ${settings.quietHours.to}: only meetings alert`, alerts.isQuiet],
  ]
  for (const [what, title, note, isOn] of rows) {
    body += `<rect x="${pad}" y="${y}" width="${width - pad * 2}" height="1" style="fill:${c('line')}"/>`
    const key = `sources:toggle:${what}`
    parts.push({ key, leftPx: width - pad - 50, widthPx: 52, topPx: y + 10, heightPx: 34 })
    body += `<text x="${pad}" y="${y + 24}" ${SANS} font-size="15" style="fill:${c('ink')}">${title}</text>` +
      `<text x="${pad}" y="${y + 43}" ${SANS} font-size="13" style="fill:${c('faint')}">${esc(fit(note, width - pad * 2 - 64, 13))}</text>` + toggle(width - pad - 44, y + 27, isOn)
    y += 54
  }
  const height = y + 8
  return { svg: panel(width, height, cardBox(width, height) + body), height, parts }
}

/** Checking: what the watcher is doing, Restart, and demo on or off. */
export function checkingSvg(width: number, state: InboxState, isDemo: boolean, hover: string): { svg: string; height: number; parts: Part[] } {
  const pad = 18
  const said = state.mode === 'watch' ? 'This window checks your sources.' : state.mode === 'tail' ? 'Another Claude Code window checks; this one shows the same inbox.'
    : state.mode === 'demo' ? 'Demo: made-up messages, nothing is really sent.' : state.mode === 'error' ? 'Checking stopped.' : 'Starting…'
  const text = lines(said, width - pad * 2, 14.5, 2)
  let body = text.map((line, index) => `<text x="${pad}" y="${pad + 14 + index * 20}" ${SANS} font-size="14.5" style="fill:${c('ink')}">${esc(line)}</text>`).join('')
  const y = pad + text.length * 20 + 8
  const row = buttons([['sources:restart', 'Restart checking', 'outline'], ['sources:demo', isDemo ? 'Leave the demo' : 'Try the demo', 'outline']], pad, width - pad, y, hover, 34, 14)
  body += row.body
  const height = y + 34 + pad
  return { svg: panel(width, height, cardBox(width, height) + body), height, parts: row.parts }
}


/** "← Inbox" and a line for what just happened. */
export function topSvg(width: number, setup: InboxSetup, hover: string): { svg: string; height: number; parts: Part[] } {
  const note = setup.error || setup.message || (setup.busy ? 'Working…' : '')
  const label = '← Inbox'
  const w = textWidth(label, 14.5, true) + 24
  const key = 'sources:back'
  const body = (hover === key ? `<rect x="0" y="2" width="${w}" height="34" rx="10" style="fill:${c('card2')}"/>` : '') +
    `<text x="12" y="24" ${SANS} font-size="14.5" font-weight="600" style="fill:${c('muted')}">${label}</text>` +
    (note ? `<text x="${width - 2}" y="24" text-anchor="end" ${SANS} font-size="14" style="fill:${setup.error ? c('red') : c('green')}">${esc(fit(note, width - w - 20, 14))}</text>` : '')
  return { svg: panel(width, 38, body), height: 38, parts: [{ key, leftPx: 0, widthPx: w, topPx: 2, heightPx: 34 }] }
}

