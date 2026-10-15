// The arbiter's rules (BUILD_PLAN.md section 4): one pane slot by priority, one card slot with a
// queue, and no band at all when there is nothing to say.

import { describe, expect, test } from 'claude-code/testing'
import {
  bandPlan, currentCard, dropCard, dropCardsOf, initialArbiter, MAX_CARDS, paneClosed, pruneCards, pushCard, releasePane,
  clearAutoBlocks, requestPane, shouldAutoClose, touchPane, type ArbiterState, type Card, type PaneView,
} from '../../hooks/core/arbiter.ts'

const view = (owner: string, reason: PaneView['reason'], name = 'main'): PaneView =>
  ({ owner, view: name, title: owner, reason })
const card = (id: string, kind: Card['kind'], at = 0, expiresAt?: number): Card =>
  ({ id, kind, at, ...(expiresAt === undefined ? {} : { expiresAt }) })

const ask = (state: ArbiterState, next: PaneView) => requestPane(state, next)

describe('pane slot', () => {
  test('an empty slot takes anything', async () => {
    for (const reason of ['hold', 'user', 'auto'] as const) {
      const { decision } = ask(initialArbiter(), view('files', reason))
      expect(decision.kind).toBe('show')
    }
  })

  test('what you open replaces what you opened before', async () => {
    const first = ask(initialArbiter(), view('files', 'user')).state
    const { state, decision } = ask(first, view('replay', 'user'))
    expect(decision.kind).toBe('show')
    expect(state.pane?.owner).toBe('replay')
  })

  test('a hold takes the slot over anything, and what you opened comes back after', async () => {
    const opened = ask(initialArbiter(), view('files', 'user')).state
    const held = ask(opened, view('blast', 'hold'))
    expect(held.decision.kind).toBe('show')
    expect(held.state.under?.owner).toBe('files')
    const released = releasePane(held.state, 'blast')
    expect(released.decision).toEqual({ kind: 'show', view: view('files', 'user') })
    expect(released.state.pane?.owner).toBe('files')
    expect(released.state.under).toBeNull()
  })

  test('an automatic open is not brought back after a hold', async () => {
    const auto = ask(initialArbiter(), view('agents', 'auto')).state
    const held = ask(auto, view('blast', 'hold')).state
    expect(held.under).toBeNull()
    expect(releasePane(held, 'blast').decision).toEqual({ kind: 'close' })
  })

  test('one hold at a time: a second one queues', async () => {
    const held = ask(initialArbiter(), view('blast', 'hold')).state
    expect(ask(held, view('blast', 'hold', 'second')).decision.kind).toBe('queued')
  })

  test('opening something during a hold waits until the hold is released', async () => {
    const held = ask(initialArbiter(), view('blast', 'hold')).state
    const queued = ask(held, view('replay', 'user'))
    expect(queued.decision.kind).toBe('queued')
    expect(queued.state.pane?.owner).toBe('blast')
    expect(releasePane(queued.state, 'blast').state.pane?.owner).toBe('replay')
  })

  test('automatic opens cover a pane you left alone, give it back after, and never cover one you used', async () => {
    const opened = ask(initialArbiter(), view('replay', 'user')).state
    const covered = ask(opened, view('agents', 'auto'))
    expect(covered.decision.kind).toBe('show')
    expect(covered.state.under?.owner).toBe('replay')
    expect(releasePane(covered.state, 'agents').decision).toEqual({ kind: 'show', view: view('replay', 'user') })
    expect(ask(touchPane(opened), view('files', 'auto')).decision.kind).toBe('refused')
    const held = ask(initialArbiter(), view('blast', 'hold')).state
    expect(ask(held, view('files', 'auto')).decision.kind).toBe('refused')
  })

  test('closing an automatic open yourself blocks it until the next turn', async () => {
    const auto = ask(initialArbiter(), view('agents', 'auto')).state
    const closed = paneClosed(auto, 'person')
    expect(closed.pane).toBeNull()
    expect(ask(closed, view('agents', 'auto')).decision).toEqual({ kind: 'refused', reason: 'you closed it' })
    // ...but you can still open it yourself, and the next turn may open it again.
    expect(ask(closed, view('agents', 'user')).decision.kind).toBe('show')
    expect(ask(clearAutoBlocks(closed), view('agents', 'auto')).decision.kind).toBe('show')
  })

  test('a plugin or unload close does not block anything', async () => {
    const auto = ask(initialArbiter(), view('agents', 'auto')).state
    expect(ask(paneClosed(auto, 'plugin'), view('agents', 'auto')).decision.kind).toBe('show')
    expect(ask(paneClosed(auto, 'unload'), view('agents', 'auto')).decision.kind).toBe('show')
  })

  test('closing a hold yourself brings nothing back in its place', async () => {
    const opened = ask(initialArbiter(), view('files', 'user')).state
    const held = ask(opened, view('blast', 'hold')).state
    const closed = paneClosed(held, 'person')
    expect(closed.pane).toBeNull()
    expect(closed.under).toBeNull()
  })

  test('an automatic open closes by itself only if you never touched it', async () => {
    const auto = ask(initialArbiter(), view('files', 'auto')).state
    expect(shouldAutoClose(auto, 'files')).toBe(true)
    expect(shouldAutoClose(touchPane(auto), 'files')).toBe(false)
    expect(shouldAutoClose(auto, 'agents')).toBe(false)
  })

  test('releasing a pane you do not own changes nothing', async () => {
    const opened = ask(initialArbiter(), view('files', 'user')).state
    expect(releasePane(opened, 'blast')).toEqual({ state: opened, decision: { kind: 'none' } })
  })
})

describe('card slot', () => {
  const ctx = { now: 0, isIdle: true, hasSurvey: false }

  test('the highest card shows; lower ones wait in order', async () => {
    let state = initialArbiter()
    state = pushCard(state, card('r', 'reflect', 1))
    state = pushCard(state, card('n', 'needs', 2))
    state = pushCard(state, card('m', 'meeting', 3))
    expect(currentCard(state, ctx)?.id).toBe('m')
    state = dropCard(state, 'm')
    expect(currentCard(state, ctx)?.id).toBe('n')
    state = dropCard(state, 'n')
    expect(currentCard(state, ctx)?.id).toBe('r')
  })

  test('among equal cards the oldest shows first', async () => {
    const state = pushCard(pushCard(initialArbiter(), card('b', 'needs', 5)), card('a', 'needs', 1))
    expect(currentCard(state, ctx)?.id).toBe('a')
  })

  test('Reflect shows only while idle', async () => {
    const state = pushCard(initialArbiter(), card('r', 'reflect'))
    expect(currentCard(state, { ...ctx, isIdle: false })).toBeNull()
    expect(currentCard(state, ctx)?.id).toBe('r')
  })

  test('a survey hides every card', async () => {
    const state = pushCard(initialArbiter(), card('m', 'meeting'))
    expect(currentCard(state, { ...ctx, hasSurvey: true })).toBeNull()
  })

  test('expired cards never show and are pruned', async () => {
    const state = pushCard(initialArbiter(), card('r', 'reflect', 0, 100))
    expect(currentCard(state, { ...ctx, now: 100 })).toBeNull()
    expect(pruneCards(state, 100).cards).toEqual([])
    expect(pruneCards(state, 50)).toBe(state)
  })

  test('the same id replaces its earlier card', async () => {
    const state = pushCard(pushCard(initialArbiter(), card('x', 'needs', 1)), card('x', 'needs', 9))
    expect(state.cards).toEqual([card('x', 'needs', 9)])
  })

  test('over the cap the oldest lowest card goes, never a meeting', async () => {
    let state = pushCard(initialArbiter(), card('meet', 'meeting', 0))
    for (let i = 1; i <= MAX_CARDS; i++) state = pushCard(state, card(`r${i}`, 'reflect', i))
    expect(state.cards.length).toBe(MAX_CARDS)
    expect(state.cards.some(one => one.id === 'meet')).toBe(true)
    expect(state.cards.some(one => one.id === 'r1')).toBe(false)
  })
})

describe('band', () => {
  const ctx = { now: 0, isIdle: true, hasSurvey: false }

  test('quiet means no band: a bell with 0 alone is omitted', async () => {
    expect(bandPlan(initialArbiter(), ctx, { hasAgents: false, bellCount: 0 }).isShown).toBe(false)
    expect(bandPlan(initialArbiter(), ctx, { hasAgents: false }).isShown).toBe(false)
  })

  test('a card, a flow or unread items show the band', async () => {
    const none = { hasAgents: false }
    expect(bandPlan(pushCard(initialArbiter(), card('n', 'needs')), ctx, none).isShown).toBe(true)
    expect(bandPlan(initialArbiter(), ctx, { ...none, hasAgents: true }).isShown).toBe(true)
    expect(bandPlan(initialArbiter(), ctx, { ...none, bellCount: 3 }).isShown).toBe(true)
  })

  test('a survey hides the whole band', async () => {
    expect(bandPlan(initialArbiter(), { ...ctx, hasSurvey: true }, { hasAgents: true, bellCount: 5 }).isShown)
      .toBe(false)
  })
})

describe('switching a feature off', () => {
  test('its cards go; a pane Switchboard closed brings nothing back later', async () => {
    const withCards = pushCard(pushCard(initialArbiter(), card('m', 'meeting')), card('r', 'reflect'))
    expect(dropCardsOf(withCards, ['meeting']).cards.map(one => one.id)).toEqual(['r'])
    const under = ask(ask(initialArbiter(), view('files', 'user')).state, view('agents', 'auto')).state
    expect(under.under?.owner).toBe('files')
    expect(paneClosed(under, 'plugin').under).toBe(null)
  })
})
