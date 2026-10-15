// Auto (phase 10, screens 5 and 7): rules that reply, review, book or archive for you, what they are
// doing and what they did today. Pure; register.tsx makes the model calls, runs the subagents and sends
// through the watcher's guarded path.
//
// Matching is deterministic first (on, person, source, hours, repo, cap), then one Haiku classify per
// rule with the message fenced as data. Only a clear "asks" goes on; unsure means a normal item.

import type {
  AutoAsk, AutoDo, AutoDraft, AutoLogEntry, AutoPair, AutoRule, AutoState, AutoTask, AutoTaskState, InboxItem, InboxSourceId,
} from '../../../types/index.d.ts'

export type { AutoAsk, AutoDo, AutoDraft, AutoLogEntry, AutoPair, AutoRule, AutoState, AutoTask, AutoTaskState }

/** Every Auto model call: cheap and fast (BUILD_PLAN.md 2.6). */
export const AUTO_MODEL = 'haiku'
export const DEFAULT_CAP = 5
export const MAX_CAP = 50
/** A classify call that takes longer than this is "unclear". */
export const CLASSIFY_MS = 8_000
/** Items already considered, kept so a restart never acts twice. */
export const MAX_SEEN = 500
export const WORK_HOURS = { from: 9, to: 18 }

export const ASKS: readonly AutoAsk[] = ['question', 'pr_review', 'meeting', 'fyi']

/** Each kind of ask has one thing to do about it. */
export const DO_FOR: Record<AutoAsk, AutoDo> = { question: 'reply', pr_review: 'review', meeting: 'book', fyi: 'archive' }

/** Where each action can come from. */
export const DO_SOURCES: Record<AutoDo, readonly InboxSourceId[]> = {
  reply: ['slack', 'gmail'], review: ['slack', 'gmail', 'github'], book: ['slack', 'gmail'], archive: ['slack', 'gmail'],
}

/** "Asks for a PR review" → "Review and post comments": the card's words when Haiku gave none. */
export const WHEN_TEXT: Record<AutoAsk, string> = {
  question: 'Asks a question', pr_review: 'Asks for a PR review', meeting: 'Asks to meet', fyi: 'Newsletters and FYIs',
}
export const DO_TEXT: Record<AutoDo, string> = {
  reply: 'Draft a reply', review: 'Review and post comments', book: 'Book 30 min', archive: 'Archive it',
}

/** The three labels each ask is classified with; only the first goes on. */
export const ASK_LABELS: Record<AutoAsk, readonly [string, string, string]> = {
  question: ['asks the reader a question or for an answer', 'does not ask the reader anything', 'unclear'],
  pr_review: ['asks the reader to review a pull request', 'does not ask for a pull request review', 'unclear'],
  meeting: ['asks the reader to meet or for a call', 'does not ask to meet', 'unclear'],
  fyi: ['is a newsletter, digest or automated notice', 'is a personal message', 'unclear'],
}

export function initialAuto(): AutoState {
  return {
    isOn: true, isPaused: false, rules: [], tasks: [], log: [], used: { day: '', byRule: {} }, costToday: 0, draft: null,
    checkId: '', isEditing: false, now: 0,
  }
}

/** The local day, "2026-10-12": caps and the log start over each morning. */
export function dayOf(now: number): string {
  const date = new Date(now)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** A new day: today's counts and log start empty; finished tasks from earlier days go (unfinished ones stay). */
export function rollDay(state: AutoState, now: number): AutoState {
  const day = dayOf(now)
  if (state.used.day === day) return state
  return {
    ...state, used: { day, byRule: {} }, costToday: 0, log: state.log.filter(entry => dayOf(entry.at) === day),
    tasks: state.tasks.filter(task => ['waiting', 'running', 'sending'].includes(task.state) || dayOf(task.startedAt) === day),
  }
}

export const usedToday = (state: AutoState, ruleId: string, now: number) =>
  state.used.day === dayOf(now) ? state.used.byRule[ruleId] ?? 0 : 0

export function countUse(state: AutoState, ruleId: string, now: number): AutoState {
  const rolled = rollDay(state, now)
  return { ...rolled, used: { ...rolled.used, byRule: { ...rolled.used.byRule, [ruleId]: (rolled.used.byRule[ruleId] ?? 0) + 1 } } }
}

// ---- Rules -----------------------------------------------------------------------------------------

/** Sources a rule acts on: its own list, else every source its actions fit. */
export function sourcesOf(rule: AutoRule): InboxSourceId[] {
  if (rule.sources.length) return rule.sources
  return [...new Set(rule.pairs.flatMap(pair => DO_SOURCES[pair.do]))]
}

export const SOURCE_WORDS: Record<InboxSourceId, string> = { slack: 'Slack', gmail: 'Gmail', calendar: 'Calendar', github: 'GitHub', jira: 'Jira' }

/** "Slack and Gmail", "Slack, Gmail and GitHub". */
export function sourcesText(rule: AutoRule): string {
  const words = sourcesOf(rule).map(source => SOURCE_WORDS[source])
  return words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}` : words[0] ?? 'Any source'
}

/** "review PRs, book meetings": the pane's line under a rule. */
export function ruleSummary(rule: AutoRule): string {
  return rule.pairs.map(pair => pair.doText.charAt(0).toLowerCase() + pair.doText.slice(1)).join(', ')
}

/** The "Only if" chips: repo acme-*, work hours, max 5 a day. */
export function onlyIf(rule: AutoRule): string[] {
  return [...rule.repos.map(repo => `repo ${repo}`), ...(rule.workHours ? ['work hours'] : []), `max ${rule.cap} a day`]
}

/** Saved or replaced; a new rule goes to the top and starts in Ask first. */
export function saveRule(state: AutoState, rule: AutoRule): AutoState {
  const exists = state.rules.some(one => one.id === rule.id)
  const rules = exists ? state.rules.map(one => (one.id === rule.id ? rule : one)) : [{ ...rule, mode: 'ask' as const }, ...state.rules]
  return { ...state, rules }
}

export const setRule = (state: AutoState, id: string, change: (rule: AutoRule) => AutoRule): AutoState =>
  ({ ...state, rules: state.rules.map(rule => (rule.id === id ? change(rule) : rule)) })

export const deleteRule = (state: AutoState, id: string): AutoState => ({ ...state, rules: state.rules.filter(rule => rule.id !== id) })

/** A rule by number (1 = top) or by name, for /sb-rules. */
export function findRule(state: AutoState, ref: string): AutoRule | null {
  const index = Number(ref)
  if (Number.isInteger(index) && index >= 1) return state.rules[index - 1] ?? null
  const wanted = ref.trim().toLowerCase()
  return state.rules.find(rule => rule.name.toLowerCase() === wanted) ?? state.rules.find(rule => rule.name.toLowerCase().startsWith(wanted)) ?? null
}

// ---- Matching --------------------------------------------------------------------------------------

const norm = (text: string) => text.toLowerCase().replace(/[^a-z0-9@.]+/g, ' ').trim()

/** The rule's person is the sender: the whole name, the email or the handle. */
export function isPerson(person: string, from: InboxItem['from']): boolean {
  const wanted = norm(person)
  if (!wanted) return true
  return [from.name, from.email, from.handle].some(value => !!value && norm(value) === wanted) ||
    (!!from.email && wanted.includes('@') && from.email.toLowerCase() === wanted)
}

/** Bots and automated senders never trigger a rule, so two auto-repliers can't loop. */
export function isBot(item: InboxItem): boolean {
  return /^B[A-Z0-9]{6,}$/.test(item.from.handle) || /(^|\b)(bot|no-?reply|do-?not-?reply|notifications?)(\b|$)/i.test(`${item.from.name} ${item.from.email}`)
}

export function inWorkHours(now: number): boolean {
  const date = new Date(now)
  const day = date.getDay()
  const hour = date.getHours()
  return day >= 1 && day <= 5 && hour >= WORK_HOURS.from && hour < WORK_HOURS.to
}

/** "acme-*" against a GitHub URL's owner/repo. */
export function repoMatches(url: string, repos: readonly string[]): boolean {
  const match = /github\.com\/([^/]+)\/([^/#?]+)/.exec(url)
  if (!match) return false
  const full = `${match[1]}/${match[2]}`.toLowerCase()
  return repos.some(repo => {
    const pattern = new RegExp(`^${repo.toLowerCase().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)
    return pattern.test(full) || pattern.test(match[2]!.toLowerCase())
  })
}

/** Why the rule can't act on this item, or null when the deterministic checks pass. */
export function blockedBy(state: AutoState, rule: AutoRule, item: InboxItem, now: number): string | null {
  if (!rule.isOn) return 'rule off'
  if (item.isExcluded) return 'excluded from Claude'
  if (isBot(item)) return 'from a bot'
  if (!sourcesOf(rule).includes(item.source)) return 'another source'
  if (!isPerson(rule.person, item.from)) return 'someone else'
  if (!pairsFor(rule, item).length) return 'nothing to do here'
  if (rule.workHours && !inWorkHours(now)) return 'outside work hours'
  if (rule.repos.length && item.url.includes('github.com') && !repoMatches(item.url, rule.repos)) return 'another repo'
  if (usedToday(state, rule.id, now) >= rule.cap) return 'daily cap reached'
  return null
}

/**
 * Whether a task runs without your check. Only an Auto rule, and only for a person you named: a rule for
 * anyone always asks first (archiving excepted), so a stranger's message never gets an answer unseen.
 */
export const actsAlone = (rule: AutoRule, pair: AutoPair): boolean =>
  rule.mode === 'auto' && (pair.do === 'archive' || !!norm(rule.person))

/** The rule's pairs whose action fits where the item came from. */
export const pairsFor = (rule: AutoRule, item: InboxItem): AutoPair[] =>
  rule.pairs.filter(pair => DO_SOURCES[pair.do].includes(item.source))

/** A GitHub review request asks for a review by what it is: no model call needed. */
export function isPlainAsk(pair: AutoPair, item: InboxItem): boolean {
  return pair.when === 'pr_review' && item.source === 'github' && item.kind === 'review_request'
}

export type Candidate = { rule: AutoRule; pairs: AutoPair[] }

/** The rules that may act on a new item, highest first, and the rules each one skipped for. */
export function candidates(state: AutoState, item: InboxItem, now: number): { list: Candidate[]; skipped: { rule: AutoRule; why: string }[] } {
  const list: Candidate[] = []
  const skipped: { rule: AutoRule; why: string }[] = []
  if (!state.isOn || state.isPaused || item.isRead) return { list, skipped }
  for (const rule of state.rules) {
    const why = blockedBy(state, rule, item, now)
    if (why) {
      if (why === 'daily cap reached' || why === 'outside work hours' || why === 'another repo') skipped.push({ rule, why })
      continue
    }
    list.push({ rule, pairs: pairsFor(rule, item) })
  }
  return { list, skipped }
}

const fence = (text: string) => text.replace(/<\/?message[^>]*>/gi, '')

/** The message as the classifier reads it: data inside <message> tags, never instructions. */
export function classifyText(item: InboxItem): string {
  const body = (item.body || '').slice(0, 2_000)
  return `<message source="${item.source}" kind="${fence(item.kind)}">\nFrom: ${fence(item.from.name)}\n` +
    `${item.title ? `Subject: ${fence(item.title)}\n` : ''}\n${fence(body)}\n</message>`
}

/** The classifier's label as asks / no / unclear; anything else is unclear. */
export function verdictOf(ask: AutoAsk, label: string | undefined): 'asks' | 'no' | 'unclear' {
  const [yes, no] = ASK_LABELS[ask]
  return label === yes ? 'asks' : label === no ? 'no' : 'unclear'
}

// ---- Tasks -----------------------------------------------------------------------------------------

/** "Review acme-api #482" from a GitHub URL, else the title. */
export function prName(item: InboxItem): string {
  const match = /github\.com\/[^/]+\/([^/]+)\/(?:pull|issues)\/(\d+)/.exec(item.url) ?? /github\.com\/[^/]+\/([^/]+)\/(?:pull|issues)\/(\d+)/.exec(item.body)
  return match ? `${match[1]} #${match[2]}` : item.title.slice(0, 60) || 'the PR'
}

export function taskTitle(action: AutoDo, item: InboxItem): string {
  if (action === 'reply') return `Reply to ${item.from.name}`
  if (action === 'review') return `Review ${prName(item)}`
  if (action === 'book') return `Book time with ${item.from.name}`
  return `Archive ${item.title ? `“${item.title.slice(0, 50)}”` : `${item.from.name}'s message`}`
}

export function newTask(rule: AutoRule, pair: AutoPair, item: InboxItem, id: string, now: number): AutoTask {
  return {
    id, ruleId: rule.id, ruleName: rule.name, itemId: item.id, do: pair.do, state: 'running', title: taskTitle(pair.do, item),
    target: '', text: '', edited: '', startedAt: now, note: '', actionId: '', agentId: '',
  }
}

export const addTask = (state: AutoState, task: AutoTask): AutoState =>
  ({ ...state, tasks: [task, ...state.tasks.filter(one => one.id !== task.id)].slice(0, 100) })

export const setTask = (state: AutoState, id: string, change: (task: AutoTask) => AutoTask): AutoState =>
  ({ ...state, tasks: state.tasks.map(task => (task.id === id ? change(task) : task)) })

export const taskOf = (state: AutoState, id: string) => state.tasks.find(task => task.id === id) ?? null

/** The text a reply task sends: your edit over the draft. */
export const taskText = (task: AutoTask) => task.edited || task.text

const LIVE: ReadonlySet<AutoTaskState> = new Set(['running', 'sending'])
export const running = (state: AutoState) => state.tasks.filter(task => LIVE.has(task.state))
export const waiting = (state: AutoState) => state.tasks.filter(task => task.state === 'waiting')
export const doneToday = (state: AutoState, now: number) =>
  state.tasks.filter(task => task.state === 'done' && dayOf(task.startedAt) === dayOf(now)).length

/** The next task waiting for you: the send check shows it. */
export const nextCheck = (state: AutoState) => waiting(state).slice(-1)[0] ?? null

/** /sb-pause: every running task stops, nothing new starts. */
export function pauseAll(state: AutoState): AutoState {
  return {
    ...state, isPaused: true,
    tasks: state.tasks.map(task => (LIVE.has(task.state) ? { ...task, state: 'stopped' as const, note: 'Paused with /sb-pause' } : task)),
  }
}

/** The Inbox session closed or reloaded mid-task: nothing was sent, so say so. */
export function interrupt(state: AutoState): AutoState {
  const live = state.tasks.filter(task => LIVE.has(task.state))
  if (!live.length) return state
  return { ...state, tasks: state.tasks.map(task => (LIVE.has(task.state) ? { ...task, state: 'interrupted' as const, note: 'The Inbox session restarted; nothing was sent.' } : task)) }
}

export function logIt(state: AutoState, text: string, now: number, actionId = '', undo = ''): AutoState {
  const entry: AutoLogEntry = { at: now, text: text.slice(0, 200), actionId, undo, isUndone: false }
  return { ...rollDay(state, now), log: [entry, ...rollDay(state, now).log].slice(0, 100) }
}

export const markUndone = (state: AutoState, actionId: string): AutoState =>
  ({ ...state, log: state.log.map(entry => (entry.actionId === actionId ? { ...entry, isUndone: true } : entry)) })

/** Undo types the watcher can reverse. */
export const UNDOABLE = new Set(['slack_delete', 'gmail_draft_delete', 'unarchive', 'demo'])

// ---- The send check (screen 5) ---------------------------------------------------------------------

export type Check = { isOk: boolean; text: string }

/** The four lines under the reply: people list, same person, not sent before, sends today. */
export function checksOf(state: AutoState, task: AutoTask, rule: AutoRule | null, item: InboxItem | null, now: number): Check[] {
  const first = item?.from.name.split(/\s+/)[0] ?? 'They'
  const sender = item ? [item.from.name, item.from.email].filter(Boolean) : []
  const isSamePerson = task.do !== 'reply' || (!!task.target && sender.some(one => task.target.toLowerCase().includes(one.toLowerCase())))
  const isNew = !state.tasks.some(other => other.id !== task.id && other.itemId === task.itemId && other.state === 'done')
  const used = rule ? usedToday(state, rule.id, now) : 0
  return [
    { isOk: !!rule && (!rule.person || (!!item && isPerson(rule.person, item.from))), text: rule?.person ? `${first} is on your people list` : `${rule?.name ?? 'The rule'} covers ${item ? SOURCE_WORDS[item.source] : 'this source'}` },
    { isOk: isSamePerson, text: task.do === 'reply' ? 'It goes back to the person who wrote to you' : 'It acts only on what they asked about' },
    { isOk: isNew, text: 'Not sent before' },
    { isOk: !rule || used < rule.cap, text: `Sends today|${used} of ${rule?.cap ?? DEFAULT_CAP}` },
  ]
}

/** "1 reply · as you", "a review · as you". */
export function whatGoes(task: AutoTask): string {
  if (task.do === 'reply') return '1 reply · as you'
  if (task.do === 'review') return 'a review · as you'
  if (task.do === 'book') return 'an invite · as you'
  return 'to archive 1 message'
}

// ---- The pane and the band -------------------------------------------------------------------------

/** "1 running · 1 waiting for you", or "All quiet". */
export function rightNowText(state: AutoState): string {
  const parts = [running(state).length ? `${running(state).length} running` : '', waiting(state).length ? `${waiting(state).length} waiting for you` : '']
    .filter(Boolean)
  if (state.isPaused) return 'Paused'
  return parts.join(' · ') || (state.isOn ? 'All quiet' : 'Auto mode is off')
}

/** The band in the Inbox session: "● 1 running · 1 waiting · 7 rules on". */
export function bandText(state: AutoState): string {
  const on = state.rules.filter(rule => rule.isOn).length
  if (state.isPaused) return `Paused · ${on} rule${on === 1 ? '' : 's'} on`
  return [running(state).length ? `${running(state).length} running` : '', waiting(state).length ? `${waiting(state).length} waiting` : '',
    `${on} rule${on === 1 ? '' : 's'} on`].filter(Boolean).join(' · ')
}

/** The Switchboard pane's line for Auto. */
export function statusLine(state: AutoState): string {
  if (!state.rules.length) return 'no rules yet'
  if (state.isPaused) return 'paused'
  if (!state.isOn) return 'off'
  return bandText(state)
}

/** "10:44". */
export function clock(at: number): string {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** "waiting 2 min". */
export function waitingFor(task: AutoTask, now: number): string {
  const minutes = Math.max(0, Math.round((now - task.startedAt) / 60_000))
  return minutes < 1 ? 'waiting now' : `waiting ${minutes} min`
}

// ---- What is kept ----------------------------------------------------------------------------------

/** What $.store keeps: everything but the card being made and the editing flag. */
export function stored(state: AutoState): Omit<AutoState, 'draft' | 'isEditing' | 'checkId' | 'now'> {
  const { draft: _draft, isEditing: _editing, checkId: _check, now: _now, ...kept } = state
  return kept
}

const asString = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '')

/** Reads what $.store kept, defensively: anything malformed is dropped. */
export function restore(raw: unknown, now: number): AutoState {
  const base = initialAuto()
  if (!raw || typeof raw !== 'object') return { ...base, used: { day: dayOf(now), byRule: {} } }
  const value = raw as Record<string, unknown>
  const rules = Array.isArray(value.rules) ? value.rules.map(ruleOf).filter((rule): rule is AutoRule => !!rule) : []
  const state: AutoState = {
    ...base, rules, isOn: value.isOn !== false, isPaused: value.isPaused === true,
    tasks: Array.isArray(value.tasks) ? (value.tasks as AutoTask[]).filter(task => task && typeof task.id === 'string').slice(0, 100) : [],
    log: Array.isArray(value.log) ? (value.log as AutoLogEntry[]).filter(entry => entry && typeof entry.text === 'string').slice(0, 100) : [],
    used: value.used && typeof value.used === 'object' ? value.used as AutoState['used'] : { day: '', byRule: {} },
    costToday: typeof value.costToday === 'number' ? value.costToday : 0,
  }
  return interrupt(rollDay(state, now))
}

/** One rule from storage or from the model, checked field by field. */
export function ruleOf(raw: unknown): AutoRule | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const pairs = (Array.isArray(value.pairs) ? value.pairs : []).flatMap(pairOf).slice(0, 4)
  if (typeof value.id !== 'string' || !pairs.length) return null
  const sources = (Array.isArray(value.sources) ? value.sources : []).filter((one): one is InboxSourceId =>
    ['slack', 'gmail', 'calendar', 'github', 'jira'].includes(one as string))
  const cap = typeof value.cap === 'number' && Number.isFinite(value.cap) ? Math.min(MAX_CAP, Math.max(1, Math.round(value.cap))) : DEFAULT_CAP
  return {
    id: value.id.slice(0, 40), name: asString(value.name, 60) || asString(value.person, 60) || 'Rule', person: asString(value.person, 120),
    sources, pairs, repos: (Array.isArray(value.repos) ? value.repos : []).map(one => asString(one, 80)).filter(one => /^[\w.*/-]+$/.test(one)).slice(0, 6),
    workHours: value.workHours === true, cap, mode: value.mode === 'auto' ? 'auto' : 'ask', isOn: value.isOn !== false,
    instructions: asString(value.instructions, 1_000), createdAt: typeof value.createdAt === 'number' ? value.createdAt : 0,
  }
}

function pairOf(raw: unknown): AutoPair[] {
  if (!raw || typeof raw !== 'object') return []
  const value = raw as Record<string, unknown>
  const when = value.when as AutoAsk
  if (!ASKS.includes(when)) return []
  // Each ask has its one action: a model can't pair "asks a question" with "archive".
  const action = DO_FOR[when]
  return [{ when, whenText: asString(value.whenText, 60) || WHEN_TEXT[when], do: action, doText: asString(value.doText, 60) || DO_TEXT[action] }]
}
