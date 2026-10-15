// Reflect (screen F6): suggestions found in what you said, counted up when you say them again, and
// decided from a card above the prompt. Pure; register.tsx runs the checks, the store and the writes.

import type { ReflectItem, ReflectScope, ReflectState } from '../../../types/index.d.ts'
import { SAME, similarity, type Verdict } from './rules.ts'

export type { ReflectItem, ReflectScope, ReflectState }

export const ITEMS_KEY = 'reflect.items'
export const PAUSED_KEY = 'reflect.paused'
export const MAX_ITEMS = 300
/** A pending suggestion leaves the band after this long unseen (it stays in /sb-reflect). */
export const CARD_TTL_MS = 30 * 60_000
/** Suggestions untouched this long are dropped. */
export const MAX_AGE_MS = 90 * 24 * 3_600_000
/** "Don't save" this many times on similar rules: that rule isn't suggested again. */
export const SKIP_LIMIT = 3

export function initialReflect(): ReflectState {
  return { items: [], quotes: {}, isPaused: false, chosen: {}, rewording: '', savedNow: [], isConflicted: false }
}

const isItem = (value: unknown): value is ReflectItem => {
  const item = value as ReflectItem
  return !!item && typeof item.id === 'string' && typeof item.rule === 'string' && (item.scope === 'project' || item.scope === 'global') &&
    typeof item.project === 'string' && ['pending', 'saved', 'skipped'].includes(item.status)
}

/** Stored items back, anything damaged or older than 90 days dropped. */
export function fromStore(raw: unknown, now: number): ReflectItem[] {
  return (Array.isArray(raw) ? raw : []).filter(isItem).filter(item => now - (item.lastAt ?? 0) < MAX_AGE_MS)
    .map(item => ({ ...item, count: Math.max(1, item.count ?? 1), confidence: item.confidence ?? 0.7 }))
}

/** At most 300 kept: decided ones go first, oldest first, before any pending one. */
export function capped(items: readonly ReflectItem[]): ReflectItem[] {
  if (items.length <= MAX_ITEMS) return [...items]
  const decided = items.filter(item => item.status !== 'pending').sort((a, b) => a.lastAt - b.lastAt)
  const drop = new Set(decided.slice(0, items.length - MAX_ITEMS).map(item => item.id))
  const kept = items.filter(item => !drop.has(item.id))
  return kept.slice(-MAX_ITEMS)
}

/** Items that apply here: this project's and every global one. */
export const here = (items: readonly ReflectItem[], project: string) =>
  items.filter(item => item.scope === 'global' || item.project === project)

export type Found = Verdict & { project: string; quote: string; isExplicit: boolean }

export type Recorded =
  | { kind: 'new'; item: ReflectItem }
  | { kind: 'again'; item: ReflectItem }
  /** Already in the CLAUDE.md it would go to: stored as saved, never shown. */
  | { kind: 'in-file'; item: ReflectItem }
  /** You turned down similar rules 3 times. */
  | { kind: 'declined' }

/**
 * A rule found: counts up a similar pending one (×N), is kept as saved when the target CLAUDE.md
 * has it already, is dropped after 3 "Don't save"s on similar rules, and is a new suggestion otherwise.
 */
export function record(state: ReflectState, found: Found, bullets: readonly string[], now: number, id: string): { state: ReflectState; recorded: Recorded } {
  const near = here(state.items, found.project)
  const same = near.find(item => item.status === 'pending' && similarity(item.rule, found.rule) >= SAME)
  if (same) {
    const item = { ...same, count: same.count + 1, lastAt: now, confidence: Math.max(same.confidence, found.confidence) }
    return { state: { ...state, items: state.items.map(one => (one.id === same.id ? item : one)), quotes: { ...state.quotes, [same.id]: found.quote } },
      recorded: { kind: 'again', item } }
  }
  const declined = near.filter(item => item.status === 'skipped' && similarity(item.rule, found.rule) >= SAME)
  if (!found.isExplicit && declined.reduce((sum, item) => sum + item.count, 0) >= SKIP_LIMIT) return { state, recorded: { kind: 'declined' } }
  const isInFile = bullets.some(bullet => similarity(bullet, found.rule) >= SAME)
  const item: ReflectItem = {
    id, rule: found.rule, scope: found.scope, project: found.project, confidence: found.confidence, count: 1,
    status: isInFile ? 'saved' : 'pending', firstAt: now, lastAt: now,
  }
  const items = capped([...state.items, item])
  // Quotes only for items still kept: capping drops the oldest, and their quotes go with them.
  const kept = new Set(items.filter(one => one.status === 'pending').map(one => one.id))
  const quotes = Object.fromEntries(Object.entries(isInFile ? state.quotes : { ...state.quotes, [id]: found.quote }).filter(([key]) => kept.has(key)))
  return {
    state: { ...state, items, quotes },
    recorded: isInFile ? { kind: 'in-file', item } : { kind: 'new', item },
  }
}

export function decide(state: ReflectState, id: string, status: 'saved' | 'skipped', scope: ReflectScope | undefined, now: number): ReflectState {
  return {
    ...state, rewording: state.rewording === id ? '' : state.rewording,
    items: state.items.map(item => (item.id === id && item.status === 'pending' ? { ...item, status, lastAt: now, ...(scope ? { scope } : {}) } : item)),
  }
}

export function reword(state: ReflectState, id: string, rule: string, now: number): ReflectState {
  return { ...state, items: state.items.map(item => (item.id === id ? { ...item, rule, lastAt: now, confidence: 1 } : item)) }
}

/** The pending suggestions here, newest first: the card shows the first. */
export const pendingHere = (state: ReflectState, project: string) =>
  here(state.items, project).filter(item => item.status === 'pending').sort((a, b) => b.lastAt - a.lastAt)

/** The scope the card's options show selected: what you picked, or the suggestion's own. */
export const scopeOf = (state: ReflectState, item: ReflectItem): ReflectScope => state.chosen[item.id] ?? item.scope

/** "95% sure". */
export const sureText = (confidence: number) => `${Math.round(Math.min(1, Math.max(0, confidence)) * 100)}% sure`

/** What the system prompt gets after a save this session (the rule is in CLAUDE.md too). */
export function composedRules(state: ReflectState, project: string): string {
  const rules = state.savedNow.filter(one => one.scope === 'global' || one.project === project)
  if (!rules.length) return ''
  return ['Rules the user just saved to CLAUDE.md (follow them from now on):', ...rules.map(one => `- ${one.rule}`)].join('\n')
}

/** The one line the Switchboard pane shows for Reflect. */
export function statusLine(state: ReflectState, project: string): string {
  if (state.isConflicted) return 'claude-reflect is installed; use one'
  if (state.isPaused) return 'paused'
  const waiting = pendingHere(state, project).length
  return waiting ? `${waiting} waiting` : 'listening'
}
