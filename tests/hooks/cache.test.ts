// Cache Tax (phase 6): the cold check, prices, the guard, learning the cache's lifetime, keep-warm's
// timer and pings, and the card's pictures. Pure, no engine.

import { describe, expect, test } from 'claude-code/testing'
import {
  breakEven, coldUsd, fmtDuration, guard, initialCache, isCold, learnedTtl, nextTimer, onCompact, onModelSwitch, onPing, onRequest,
  onResponse, onResume, onTurnDone, parseDuration, pingCheck, statusCard, warmUsd, type CacheState,
} from '../../hooks/features/cache/model.ts'
import { buttonsSvg, cardSvg, compactSvg } from '../../hooks/features/cache/pictures.ts'

const MIN = 60_000
const HOUR = 60 * MIN
const T0 = Date.parse('2026-10-12T09:00:00')
const usage = (write: number, read = 0) =>
  ({ model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 40, cache_read_input_tokens: read, cache_creation_input_tokens: write })

/** A session whose last request was at T0 with a 120k context on Opus 5.5. */
const warmAt = (ctx = 120_000): CacheState => ({ ...initialCache(), model: 'claude-opus-5-5', ctx, lastRequestAt: T0 })
const cents = (usd: number | null) => (usd === null ? null : Math.round(usd * 100) / 100)
const say = (text: string, extra: Partial<{ originKind: string; hasAttachments: boolean; isRunning: boolean }> = {}) =>
  ({ text, originKind: 'composer', hasAttachments: false, isRunning: false, ...extra })

describe('the cache', () => {
  test('cold an hour after the last request, or five minutes once that is learned; never right after compaction', async () => {
    expect(isCold(warmAt(), T0 + 59 * MIN)).toBe(false)
    expect(isCold(warmAt(), T0 + HOUR)).toBe(true)
    expect(isCold({ ...warmAt(), ttls: { 'claude-opus-5-5': '5m' } }, T0 + 6 * MIN)).toBe(true)
    expect(isCold(onCompact(warmAt()), T0 + 2 * HOUR)).toBe(false)
    expect(isCold(initialCache(), T0)).toBe(false)
  })

  test('prices: the 1-hour write is 2× input, the 5-minute write 1.25×; reads at the read price; break-even', async () => {
    expect(cents(coldUsd(warmAt()))).toBe(0.96) // 120k × $8
    expect(cents(coldUsd({ ...warmAt(), ttls: { 'claude-opus-5-5': '5m' } }))).toBe(0.6) // 120k × $5
    expect(cents(warmUsd(warmAt()))).toBe(0.02) // 120k × $0.20
    expect(breakEven(warmAt())).toBe(40)
    expect(coldUsd({ ...warmAt(), model: 'some-new-model' })).toBeNull()
    expect(coldUsd({ ...warmAt(), engineUsd: 0.45 })).toBe(0.45)
  })

  test('words: durations both ways', async () => {
    expect([parseDuration('6h'), parseDuration('90m'), parseDuration('1h30m'), parseDuration('soon')]).toEqual([6 * HOUR, 90 * MIN, 90 * MIN, null])
    expect([fmtDuration(398 * MIN), fmtDuration(12 * MIN), fmtDuration(51 * HOUR)]).toEqual(['6h38m', '12m', '2d 3h'])
  })
})

describe('the guard', () => {
  test('holds a big cold send; passes warm, small, slash commands, plugins and mid-turn messages', async () => {
    const later = T0 + 2 * HOUR
    const held = guard(warmAt(), say('Where were we?'), later)
    expect(held.kind).toBe('hold')
    if (held.kind === 'hold') {
      expect(held.held).toMatchObject({ tokens: 120_000, coldForMs: HOUR, writeRate: 8 })
      expect(held.drop).toContain('up to $0.96')
    }
    expect(guard(warmAt(), say('hi'), T0 + 10 * MIN).kind).toBe('pass')
    expect(guard(warmAt(40_000), say('hi'), later).kind).toBe('pass')
    expect(guard(warmAt(), say('/sb-files'), later).kind).toBe('pass')
    expect(guard(warmAt(), say('hi', { originKind: 'plugin' }), later).kind).toBe('pass')
    expect(guard(warmAt(), say('hi', { isRunning: true }), later).kind).toBe('pass')
  })

  test('sent again it goes through; a pasted image or guard warn goes through with its price', async () => {
    const later = T0 + 2 * HOUR
    const first = guard(warmAt(), say('go'), later)
    const held = first.kind === 'hold' ? { ...warmAt(), ackedAt: T0 } : warmAt()
    expect(guard(held, say('go'), later).kind).toBe('bypass')
    expect(guard(warmAt(), say('look', { hasAttachments: true }), later).kind).toBe('warn')
    expect(guard({ ...warmAt(), guard: 'warn' }, say('go'), later).kind).toBe('warn')
  })
})

describe('turns', () => {
  test('a turn that re-writes half of a 20k+ context is a cold write; one you paid for always counts', async () => {
    const miss = onTurnDone(warmAt(), usage(110_000), 120_000, 1, T0 + 2 * HOUR)
    expect(miss.miss?.tokens).toBe(110_000)
    expect(miss.state.ctx).toBe(120_000)
    expect(onTurnDone(warmAt(), usage(2_000, 118_000), 120_000, 1, T0 + 5 * MIN).miss).toBeNull()
    expect(onTurnDone({ ...warmAt(), isPaying: true }, usage(2_000), 120_000, 1, T0 + 2 * HOUR).miss).not.toBeNull()
  })

  test('the lifetime is learned from a 5–60 min gap: the first request read it (1 hour) or re-wrote it (5 minutes)', async () => {
    const gap = (read: number, write: number, gapMin: number) => {
      const opened = onRequest(warmAt(), T0 + gapMin * MIN)
      return learnedTtl(onResponse(opened, usage(write, read), 'claude-opus-5-5').turn)
    }
    expect(gap(118_000, 500, 20)).toBe('1h')
    expect(gap(0, 119_000, 20)).toBe('5m')
    expect(gap(118_000, 500, 3)).toBeNull() // under 5 min proves nothing
    expect(gap(0, 119_000, 70)).toBeNull() // past an hour both are cold
    const done = onTurnDone(onResponse(onRequest(warmAt(), T0 + 20 * MIN), usage(119_000), 'claude-opus-5-5'), usage(119_000), 120_000, 1, T0 + 21 * MIN)
    expect(done.learned).toBe('5m')
    expect(done.state.ttls['claude-opus-5-5']).toBe('5m')
  })

  test('a model switch starts the new cache cold at the engine price; a cold resume too', async () => {
    const switched = onModelSwitch(warmAt(), { to_model: 'claude-sonnet-5-5', cache_ttl: '5m', context_tokens: 100_000, estimated_cache_write_usd: 0.25 })
    expect([switched.model, switched.ttls['claude-sonnet-5-5'], isCold(switched, T0 + MIN), coldUsd(switched)]).toEqual(['claude-sonnet-5-5', '5m', true, 0.25])
    expect(onResponse(switched, usage(100), 'claude-sonnet-5-5').isForcedCold).toBe(false)
    const resumed = onResume(initialCache(), { source: 'resume', context_tokens: 90_000, seconds_since_last_response: 400, prompt_cache_likely_expired: true,
      estimated_cache_write_usd: 0.45, model: 'claude-opus-5-5' }, T0)
    expect(resumed.line).toContain('about $0.45')
    expect(isCold(resumed.state, T0)).toBe(true)
    expect(onResume(initialCache(), { source: 'startup' }, T0).line).toBe('')
  })
})

describe('keep-warm', () => {
  const armed = (state: CacheState) => ({ ...state, deadline: T0 + 6 * HOUR })

  test('the timer: a ping 50 min after the last request, never past the deadline; cold waits for the deadline only', async () => {
    expect(nextTimer(armed(warmAt()), T0 + MIN)).toEqual({ kind: 'ping', inMs: 49 * MIN })
    expect(nextTimer({ ...armed(warmAt()), deadline: T0 + 10 * MIN }, T0 + MIN)).toEqual({ kind: 'ping', inMs: 9 * MIN })
    expect(nextTimer(armed(warmAt()), T0 + 2 * HOUR)).toEqual({ kind: 'wait', inMs: 4 * HOUR })
    expect(nextTimer({ ...armed(warmAt()), ttls: { 'claude-opus-5-5': '5m' } }, T0)).toEqual({ kind: 'ping', inMs: 4 * MIN })
    expect(nextTimer(warmAt(), T0).kind).toBe('off')
  })

  test('a ping goes out when due; asleep past the lifetime it stops; near the rate limit it waits', async () => {
    expect(pingCheck(armed(warmAt()), T0 + 50 * MIN, false).kind).toBe('send')
    expect(pingCheck(armed(warmAt()), T0 + 20 * MIN, false).kind).toBe('skip')
    expect(pingCheck(armed(warmAt()), T0 + 50 * MIN, true).kind).toBe('later')
    expect(pingCheck(armed(warmAt()), T0 + 3 * HOUR, false)).toEqual({ kind: 'stop', why: 'the cache went cold while the computer slept' })
  })

  test('a warm ping moves the clock; a cold one or a failure stops keep-warm, saying why', async () => {
    const warm = onPing(armed(warmAt()), { isAnswered: true, usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 120_000, cache_creation_input_tokens: 30 } }, T0 + 50 * MIN)
    expect([warm.stop, warm.state.lastRequestAt, warm.state.lastPing?.isWarm]).toEqual(['', T0 + 50 * MIN, true])
    const cold = onPing(armed(warmAt()), { isAnswered: true, usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 120_000 } }, T0 + 50 * MIN)
    expect([cold.state.deadline, cold.stop.startsWith('the ping read 0 and wrote 120k')]).toEqual([0, true])
    expect(onPing(armed(warmAt()), { isAnswered: false, reason: 'api-error', status: 529 }, T0).stop).toBe('the API call failed (529)')
    expect(statusCard(warm.state, T0 + 51 * MIN)).toContain('keep-warm   on, 5h09m left · ping in 49m · last ping read 120k')
  })
})

describe('pictures', () => {
  test('the card names the cost, the hold and the offer; the buttons and the compact card carry the same keys', async () => {
    const held = guard(warmAt(), say('Where were we? Give me a 2 line recap.'), T0 + 2 * HOUR)
    if (held.kind !== 'hold') throw new Error('not held')
    const card = cardSvg(760, held.held)
    expect(card.svg).toContain('Your message is on hold')
    expect(card.svg).toContain('$0.96')
    expect(card.svg).toContain('at $8/MTok')
    expect(card.svg).toContain('/sb-cache warm keeps it warm after')
    const keys = ['cache:pay', 'cache:fresh', 'cache:status']
    expect(buttonsSvg(760, '').parts.map(part => part.key)).toEqual(keys)
    const compact = compactSvg(760, held.held, '')
    expect(compact.parts.map(part => part.key)).toEqual(keys)
    expect(compact.height).toBeLessThan(12 * 19)
  })
})
