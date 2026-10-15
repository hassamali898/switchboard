// The arbiter: the one place that decides what Switchboard shows (BUILD_PLAN.md section 4).
// Features ask it; they never open panes or draw band rows themselves. Pure functions over a plain
// state value, so register.tsx keeps the state in `$.state` and every rule here is unit-tested.
//
// - One side pane (id `switchboard`), its content swapped by priority: a Blast Radius hold, then
//   what you opened, then the Inbox pane in the Inbox session, then automatic opens.
// - One card slot above the prompt, with a queue: meeting, Blast fallback, Cache Tax hold,
//   needs-you, Reflect (idle only).
// - One status row under it. The band is omitted entirely when there is nothing to say.

import type { ArbiterState, Card, CardKind, PaneReason, PaneView } from '../../types/index.d.ts'

export type { ArbiterState, Card, CardKind, PaneReason, PaneView }

export const PANE_ID = 'switchboard'

const CARD_RANK: Record<CardKind, number> = { meeting: 8, blast: 7, cache: 6, check: 5, rule: 4, needs: 2, reflect: 1 }

export const MAX_CARDS = 20
/** How long an automatically opened pane stays after its reason ends, unless you touched it. */
export const AUTO_CLOSE_MS: Readonly<Record<string, number>> = { agents: 8_000, files: 20_000 }

export function initialArbiter(): ArbiterState {
  return { pane: null, under: null, blockedAuto: [], cards: [] }
}

const autoKey = (view: PaneView) => `${view.owner}:${view.view}`

export type PaneDecision =
  /** Open (or retitle) the pane with this view now. */
  | { kind: 'show'; view: PaneView }
  /** Waits behind a hold; it shows when the hold is released. */
  | { kind: 'queued' }
  /** Not shown: something with a better claim holds the pane, or you closed it before. */
  | { kind: 'refused'; reason: string }

/** A feature asks for the pane. */
export function requestPane(state: ArbiterState, view: PaneView): { state: ArbiterState; decision: PaneDecision } {
  const current = state.pane
  const show = (next: ArbiterState) => ({ state: next, decision: { kind: 'show', view } as const })

  switch (view.reason) {
    case 'hold':
      if (current?.reason === 'hold') return { state, decision: { kind: 'queued' } } // one hold at a time
      // Automatic opens aren't brought back after a hold; what you opened is.
      return show({ ...state, pane: view, under: current && current.reason !== 'auto' ? current : state.under })
    case 'user':
      if (current?.reason === 'hold') return { state: { ...state, under: view }, decision: { kind: 'queued' } }
      return show({ ...state, pane: view })
    case 'auto':
      if (state.blockedAuto.includes(autoKey(view))) return { state, decision: { kind: 'refused', reason: 'you closed it' } }
      if (!current || (current.owner === view.owner && current.reason === 'auto')) return show({ ...state, pane: view })
      // A pane you haven't touched gives way while the work runs, and comes back when it ends.
      if (current.reason !== 'hold' && !current.isTouched) {
        return show({ ...state, pane: view, under: current.reason === 'auto' ? state.under : { ...current } })
      }
      return { state, decision: { kind: 'refused', reason: 'pane in use' } }
  }
}

/** The pane closed. `person`: you closed it (✕ or Esc). */
export function paneClosed(state: ArbiterState, origin: 'person' | 'plugin' | 'unload'): ArbiterState {
  const current = state.pane
  if (!current) return state
  if (origin === 'person') {
    const blockedAuto = current.reason === 'auto' && !state.blockedAuto.includes(autoKey(current))
      ? [...state.blockedAuto, autoKey(current)] : state.blockedAuto
    // You closed it on purpose: nothing pops up in its place.
    return { ...state, pane: null, under: null, blockedAuto }
  }
  // Switchboard closed it (a command, a feature off): nothing comes back later either.
  return origin === 'plugin' ? { ...state, pane: null, under: null } : { ...state, pane: null }
}

export type ReleaseDecision = { kind: 'show'; view: PaneView } | { kind: 'close' } | { kind: 'none' }

/** The owner is done with the pane (a hold was decided, a run ended): what was under it comes back. */
export function releasePane(state: ArbiterState, owner: string): { state: ArbiterState; decision: ReleaseDecision } {
  if (state.pane?.owner !== owner) return { state, decision: { kind: 'none' } }
  if (state.under) return { state: { ...state, pane: state.under, under: null }, decision: { kind: 'show', view: state.under } }
  return { state: { ...state, pane: null }, decision: { kind: 'close' } }
}

/** A new turn: panes you closed may open by themselves again (closing one holds only for its turn). */
export const clearAutoBlocks = (state: ArbiterState): ArbiterState => (state.blockedAuto.length ? { ...state, blockedAuto: [] } : state)

/** You clicked or typed in the pane. */
export function touchPane(state: ArbiterState): ArbiterState {
  return state.pane && !state.pane.isTouched ? { ...state, pane: { ...state.pane, isTouched: true } } : state
}

/** Whether an automatic open by `owner` should close now that its reason ended (after AUTO_CLOSE_MS). */
export function shouldAutoClose(state: ArbiterState, owner: string): boolean {
  const pane = state.pane
  return !!pane && pane.reason === 'auto' && pane.owner === owner && !pane.isTouched
}

/** Asks for the card slot. The same id replaces its earlier card; the queue keeps the newest MAX_CARDS. */
export function pushCard(state: ArbiterState, card: Card): ArbiterState {
  const others = state.cards.filter(one => one.id !== card.id)
  const cards = [...others, card]
  return { ...state, cards: cards.length > MAX_CARDS ? dropLowest(cards) : cards }
}

function dropLowest(cards: Card[]): Card[] {
  // Over the cap: the oldest of the lowest rank goes first, so a meeting is never pushed out.
  const sorted = [...cards].sort((a, b) => CARD_RANK[a.kind] - CARD_RANK[b.kind] || a.at - b.at)
  const gone = sorted[0]
  return cards.filter(one => one !== gone)
}

export function dropCard(state: ArbiterState, id: string): ArbiterState {
  return state.cards.some(one => one.id === id) ? { ...state, cards: state.cards.filter(one => one.id !== id) } : state
}

/** Every card of these kinds goes (a feature was switched off). */
export function dropCardsOf(state: ArbiterState, kinds: readonly CardKind[]): ArbiterState {
  return state.cards.some(one => kinds.includes(one.kind)) ? { ...state, cards: state.cards.filter(one => !kinds.includes(one.kind)) } : state
}

export function pruneCards(state: ArbiterState, now: number): ArbiterState {
  const cards = state.cards.filter(one => one.expiresAt === undefined || one.expiresAt > now)
  return cards.length === state.cards.length ? state : { ...state, cards }
}

export type BandContext = {
  now: number
  /** No turn is running. */
  isIdle: boolean
  /** The app shows a survey there: we show nothing. */
  hasSurvey: boolean
}

/** The one card to show now, or null. A lower card waits; it never shows on top of a higher one. */
export function currentCard(state: ArbiterState, context: BandContext): Card | null {
  if (context.hasSurvey) return null
  const eligible = state.cards.filter(one =>
    (one.expiresAt === undefined || one.expiresAt > context.now) && (one.kind !== 'reflect' || context.isIdle))
  if (eligible.length === 0) return null
  return [...eligible].sort((a, b) => CARD_RANK[b.kind] - CARD_RANK[a.kind] || a.at - b.at)[0] ?? null
}

export type StatusParts = {
  /** A flow is running (Agents progress row). */
  hasAgents: boolean
  /** Inbox is on: the bell's unread count; undefined when Inbox is off. */
  bellCount?: number
}

export type BandPlan = {
  card: Card | null
  status: StatusParts
  /** False: draw nothing at all, pass the band on (`next(e)`). */
  isShown: boolean
}

/** What the band above the prompt shows. Quiet means no band at all: a bell with 0 alone is omitted. */
export function bandPlan(state: ArbiterState, context: BandContext, status: StatusParts): BandPlan {
  if (context.hasSurvey) return { card: null, status, isShown: false }
  const card = currentCard(state, context)
  const isShown = card !== null || status.hasAgents || (status.bellCount ?? 0) > 0
  return { card, status, isShown }
}
