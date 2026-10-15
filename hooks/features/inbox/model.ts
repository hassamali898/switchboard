// The Inbox (screens 1, 3 and 4): items from the watcher's stream, what needs you, the bell, the
// pane's filters and the reply being written. Pure; register.tsx runs the watcher, the CLI and the model.

import type {
  InboxItem, InboxLevel, InboxReply, InboxSourceId, InboxSourceState, InboxState, ReplyOption,
} from '../../../types/index.d.ts'

export type { InboxItem, InboxLevel, InboxReply, InboxSourceId, InboxSourceState, InboxState, ReplyOption }

export const MAX_ITEMS = 300
/** Send waits this long for Undo. */
export const UNDO_MS = 5_000
/** "Remind me in 1 hour". */
export const REMIND_MS = 3_600_000
export const SOURCES: readonly InboxSourceId[] = ['slack', 'gmail', 'calendar', 'github', 'jira']
export const SOURCE_NAME: Record<InboxSourceId, string> = { slack: 'Slack', gmail: 'Gmail', calendar: 'Calendar', github: 'GitHub', jira: 'Jira' }
/** The badge on each row (screen 3). */
export const BADGE: Record<InboxSourceId, string> = { slack: 'SLACK', gmail: 'MAIL', calendar: 'CAL', github: 'GH', jira: 'JIRA' }

export function initialInbox(): InboxState {
  return { mode: 'off', items: [], sources: {}, filter: 'all', query: '', dismissed: [], remindAt: {}, reply: null, meetingCard: null, costToday: 0, isHome: false, setup: null, now: 0 }
}

// ---- Reading the watcher ---------------------------------------------------------------------------

const text = (value: unknown, max = 20_000) => (typeof value === 'string' ? value.slice(0, max) : '')
const LEVELS: readonly InboxLevel[] = ['critical', 'high', 'normal', 'quiet']

/** One item from the stream, or null when it isn't one (anything malformed is skipped, never trusted). */
export function itemOf(raw: unknown): InboxItem | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const source = item.source as InboxSourceId
  if (typeof item.id !== 'string' || !SOURCES.includes(source)) return null
  const from = (item.from && typeof item.from === 'object' ? item.from : {}) as Record<string, unknown>
  const thread = (item.thread && typeof item.thread === 'object' ? item.thread : {}) as Record<string, unknown>
  const at = Date.parse(text(item.received_at, 40))
  return {
    id: item.id.slice(0, 300), num: typeof item.num === 'number' ? item.num : 0, source, kind: text(item.kind, 40) || 'message',
    from: { name: text(from.name, 200) || text(from.email, 200) || 'Someone', handle: text(from.handle, 200), email: text(from.email, 200) },
    title: text(item.title, 500), body: text(item.body), url: text(item.url, 2000),
    threadCount: typeof thread.count === 'number' ? thread.count : 1,
    level: LEVELS.includes(item.level as InboxLevel) ? (item.level as InboxLevel) : 'normal',
    receivedAt: Number.isNaN(at) ? 0 : at, isRead: item.read === true, isExcluded: item.excluded === true, via: text(item.via, 20),
    threadId: text(thread.id, 300), files: (Array.isArray(item.files) ? item.files : []).map(one => text(one, 200)).filter(Boolean).slice(0, 10),
    details: detailsOf(item.details),
  }
}

/** The source's details, as short strings (lists of strings kept as lists). Anything else is dropped. */
function detailsOf(raw: unknown): Record<string, string | string[]> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, string | string[]> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>).slice(0, 20)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') out[key.slice(0, 40)] = String(value).slice(0, 500)
    else if (Array.isArray(value)) out[key.slice(0, 40)] = value.flatMap(one => (typeof one === 'string' ? [one.slice(0, 200)] : one && typeof one === 'object' && typeof (one as { name?: unknown }).name === 'string' ? [String((one as { name: string }).name).slice(0, 200)] : [])).slice(0, 30)
  }
  return out
}

const newestFirst = (a: InboxItem, b: InboxItem) => b.receivedAt - a.receivedAt || b.num - a.num

/** Items in, replacing ones with the same id (an edit updates in place). */
export function withItems(state: InboxState, items: readonly InboxItem[]): InboxState {
  const byId = new Map(state.items.map(item => [item.id, item]))
  for (const item of items) byId.set(item.id, item)
  return { ...state, items: [...byId.values()].sort(newestFirst).slice(0, MAX_ITEMS) }
}

export type WatcherEvent =
  | { type: 'hello'; mode: string }
  | { type: 'snapshot'; items: unknown[] }
  | { type: 'item'; new: boolean; item: unknown }
  | { type: 'source'; source: string; state: string; message: string }
  | { type: 'ping' }

/** One line of the watcher's NDJSON stream, or null. */
export function eventOf(line: string): WatcherEvent | null {
  try {
    const value = JSON.parse(line) as { type?: unknown }
    return value && typeof value.type === 'string' ? (value as WatcherEvent) : null
  } catch {
    return null
  }
}

export type Applied = { state: InboxState; fresh: InboxItem | null }

/** A stream event applied; `fresh` is an item that just arrived (a toast, maybe a card). */
export function onEvent(state: InboxState, event: WatcherEvent): Applied {
  if (event.type === 'hello') {
    const mode = event.mode === 'tail' ? 'tail' : event.mode === 'demo' ? 'demo' : 'watch'
    return { state: { ...state, mode }, fresh: null }
  }
  if (event.type === 'snapshot') {
    const items = (Array.isArray(event.items) ? event.items : []).map(itemOf).filter((item): item is InboxItem => !!item)
    return { state: withItems({ ...state, items: [] }, items), fresh: null }
  }
  if (event.type === 'item') {
    const item = itemOf(event.item)
    if (!item) return { state, fresh: null }
    // An item this window already has is never news again, whatever the stream says (a re-ingested one).
    const isKnown = state.items.some(one => one.id === item.id)
    return { state: withItems(state, [item]), fresh: event.new && !item.isRead && !isKnown ? item : null }
  }
  if (event.type === 'source' && typeof event.source === 'string') {
    const one = { state: text(event.state, 40), message: text(event.message, 300) }
    return { state: { ...state, sources: { ...state.sources, [event.source.slice(0, 40)]: one } }, fresh: null }
  }
  return { state, fresh: null }
}

// ---- What needs you --------------------------------------------------------------------------------

const isNeedsLevel = (item: InboxItem) => item.level === 'critical' || item.level === 'high'

/** Unread Critical and High items: the "Needs you" list, most urgent first. */
export function needsYou(state: InboxState): InboxItem[] {
  return state.items.filter(item => !item.isRead && isNeedsLevel(item))
    .sort((a, b) => (a.level === b.level ? newestFirst(a, b) : a.level === 'critical' ? -1 : 1))
}

/** The bell: unread items that aren't quiet. */
export const bellCount = (state: InboxState) => state.items.filter(item => !item.isRead && item.level !== 'quiet').length

/** The one Critical item a coding session's card shows now: unread, not dismissed, not put off. */
export function needsCard(state: InboxState, now: number): InboxItem | null {
  return state.items.find(item => item.level === 'critical' && !item.isRead && !state.dismissed.includes(item.id) &&
    (state.remindAt[item.id] ?? 0) <= now) ?? null
}

export const dismiss = (state: InboxState, id: string): InboxState =>
  state.dismissed.includes(id) ? state : { ...state, dismissed: [...state.dismissed, id].slice(-200) }

export const remindLater = (state: InboxState, id: string, now: number): InboxState =>
  ({ ...state, remindAt: { ...state.remindAt, [id]: now + REMIND_MS } })

export const markRead = (state: InboxState, ids: readonly string[]): InboxState =>
  ({ ...state, items: state.items.map(item => (ids.includes(item.id) ? { ...item, isRead: true } : item)) })

// ---- The pane --------------------------------------------------------------------------------------

/** Search: who it's from, the title and the text, any word order. */
export function matches(item: InboxItem, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = `${item.from.name} ${item.from.email} ${item.from.handle} ${item.title} ${item.isExcluded ? '' : item.body}`.toLowerCase()
  return words.every(word => hay.includes(word))
}

export const shown = (state: InboxState) =>
  state.items.filter(item => (state.filter === 'all' || item.source === state.filter) && matches(item, state.query))

/** "All 8", "Slack 3": the filter buttons, only for sources with items (All always). */
export function filters(state: InboxState): { key: string; label: string; count: number }[] {
  const unread = state.items.filter(item => !item.isRead)
  const out = [{ key: 'all', label: 'All', count: unread.length }]
  for (const source of SOURCES) {
    const count = unread.filter(item => item.source === source).length
    if (count || state.filter === source) out.push({ key: source, label: SOURCE_NAME[source], count })
  }
  return out
}

/** The pane's two lists: unread Critical and High, then everything else (today first). */
export function lists(state: InboxState): { needs: InboxItem[]; rest: InboxItem[] } {
  const visible = shown(state)
  const needs = visible.filter(item => !item.isRead && isNeedsLevel(item))
  const needIds = new Set(needs.map(item => item.id))
  return { needs, rest: visible.filter(item => !needIds.has(item.id)) }
}

const LIVE = new Set(['live', 'polling'])

/** Sources working now, and the first one that needs you to act. */
export function sourcesSummary(state: InboxState): { live: number; problem: { source: string; message: string } | null } {
  let live = 0
  let problem: { source: string; message: string } | null = null
  for (const [source, one] of Object.entries(state.sources)) {
    if (LIVE.has(one.state)) live++
    else if (!problem && ['setup', 'auth', 'error', 'paused'].includes(one.state)) problem = { source, message: one.message }
  }
  if (state.mode === 'demo') live = Math.max(live, 1)
  return { live, problem }
}

/** "8 new today": items received since local midnight. */
export function newToday(state: InboxState, now: number): number {
  const midnight = new Date(now)
  midnight.setHours(0, 0, 0, 0)
  return state.items.filter(item => item.receivedAt >= midnight.getTime()).length
}

/** "2 min", "1h", "3d": how long ago. */
export function ago(at: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - at) / 60_000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`
}

/** Who and what, one line each, for a row. */
export function rowText(item: InboxItem): { who: string; what: string } {
  const what = item.title || item.body.split('\n')[0] || ''
  return { who: item.from.name, what: item.isExcluded ? 'excluded from Claude' : what }
}

/** The one line the Switchboard pane shows for Inbox. */
export function statusLine(state: InboxState): string {
  if (state.mode === 'off') return 'off'
  if (state.mode === 'error') return 'the watcher stopped'
  if (state.mode === 'starting') return 'starting'
  const needs = needsYou(state).length
  const count = bellCount(state)
  const { problem } = sourcesSummary(state)
  if (!count && problem) return `${SOURCE_NAME[problem.source as InboxSourceId] ?? problem.source}: set up`
  return `${count} new${needs ? ` · ${needs} need you` : ''}${state.mode === 'demo' ? ' · demo' : ''}`
}

// ---- The reply -------------------------------------------------------------------------------------

/** Sources whose messages get a reply; the others get their actions (Join, Comment, Move to…). */
export const REPLY_SOURCES: ReadonlySet<InboxSourceId> = new Set(['slack', 'gmail'])

/** Opens a message in the pane: a reply source starts drafting (unless excluded from Claude). */
export function startReply(state: InboxState, id: string): InboxState {
  const item = state.items.find(one => one.id === id)
  const canReply = !!item && REPLY_SOURCES.has(item.source)
  const reply: InboxReply = {
    id, phase: !canReply ? 'view' : item?.isExcluded ? 'ready' : 'drafting', option: 'short', drafts: { short: '', detailed: '', ask: '' },
    thirdLabel: 'Ask a question', edited: '', target: '', replyAll: false, error: '', failCode: '',
    note: item?.isExcluded ? 'Excluded from Claude, so nothing was drafted. Use Edit to write your reply.' : '', sendAt: 0, actionId: '', undo: '',
    full: '', improve: 'off', improved: '', status: String(item?.details.status ?? ''), choices: [], isCommenting: false, busy: '',
  }
  return { ...state, reply }
}

/** Mark all read: every unread item, here at once (the queue follows). */
export const markAllRead = (state: InboxState): InboxState => ({ ...state, items: state.items.map(item => (item.isRead ? item : { ...item, isRead: true })) })

/** Whether the reply can be sent now: a text, a recipient, and nothing in flight. */
export const canSend = (reply: InboxReply) =>
  !!replyText(reply).trim() && !!reply.target && ['ready', 'error', 'failed'].includes(reply.phase) && reply.improve !== 'working'

export const withReply = (state: InboxState, change: (reply: InboxReply) => InboxReply): InboxState =>
  (state.reply ? { ...state, reply: change(state.reply) } : state)

/** The text that would go: your edit, else the chosen draft. */
export const replyText = (reply: InboxReply) => reply.edited || reply.drafts[reply.option]

export const replyItem = (state: InboxState) => (state.reply ? state.items.find(item => item.id === state.reply?.id) ?? null : null)

/** A send's idempotency key: the message and the exact text (FNV-1a), so the same reply to the same message
 * never goes twice, however many times Send is pressed; changed text is a new reply. */
export function replyKey(id: string, text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0
  return `${id}:${text.length}:${hash.toString(16)}`
}

// ---- Connector permission ----------------------------------------------------------------------------
// A plugin's connector call goes through the person's permission rules, and nobody can answer "ask" for it
// (auto mode's classifier gives it no verdict either), so a tool the rules don't allow is refused. The
// person allows the read-only tools once; Switchboard never asks for one that sends.

/** Each source's other read-only tools, beside the search that was refused. */
const READ_TOOLS: Record<string, readonly string[]> = {
  gmail: ['search_threads', 'get_thread'], slack: ['slack_read_thread'], jira: ['getAccessibleAtlassianResources'],
}
const WRITES = /create|update|delete|remove|add|edit|post|send|reply|forward|transition|merge|close|move|write|set|cancel|respond|trash|label|draft/i

/** `$.mcp.call(server, tool) refused: …` → the read-only rules to allow for that source; null for any other error. */
export function refusedRules(source: string, message: string): string[] | null {
  const match = /\$\.mcp\.call\(([\w.-]+), (\w+)\) refused:/.exec(message)
  if (!match) return null
  const [, server = '', tool = ''] = match
  const rules = [...new Set([tool, ...(READ_TOOLS[source] ?? [])])].filter(name => !WRITES.test(name)).map(name => `mcp__${server}__${name}`)
  return rules.length ? rules : null
}

/** What Allow puts in the prompt: the person sends it, and Claude asks before it changes their settings. */
export function allowRequest(name: string, rules: readonly string[]): string {
  return `Let Switchboard read my ${name}: add these read-only connector tools to "permissions.allow" in ~/.claude/settings.json (nothing that sends): ${rules.join(', ')}`
}
