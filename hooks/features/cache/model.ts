// Cache Tax (screen F7): when the prompt cache has gone cold, the next message re-writes the whole
// context at the cache-write price. This holds that message until you choose, prices it, and keeps
// the cache warm with small pings when you ask. Pure; register.tsx runs the hooks, timers and store.
// Ported from karanb192/cache-tax (hooks/register.ts), MIT License, Copyright (c) 2026 Karan Bansal:
// the cold check, the guard and its resend bypass, the ping and its warm check, the miss check, the
// break-even and the status lines. Changed: the TTL is learned per model (cache-tax assumes 1 hour),
// the held message waits on a card, and the engine's own cold-write estimate is used when it gives one.

import type { CacheHeld, CacheMiss, CachePing, CacheState, CacheTtl } from '../../../types/index.d.ts'
import { cacheRates, modelName, type Usage } from '../../core/prices.ts'

export type { CacheHeld, CacheMiss, CachePing, CacheState, CacheTtl }

export const TTL_MS: Record<CacheTtl, number> = { '5m': 5 * 60_000, '1h': 60 * 60_000 }
/** A ping this long after the last request keeps the cache read, not re-written. */
export const PING_AFTER_MS: Record<CacheTtl, number> = { '5m': 4 * 60_000, '1h': 50 * 60_000 }
export const MIN_PING_MS = 60_000
export const DEFAULT_WINDOW_MS = 6 * 3_600_000
/** Smaller contexts are cheap to re-write: never held. */
export const BIG_TOKENS = 50_000
/** A turn that re-wrote half of a context this big was a cold write. */
const MISS_FLOOR = 20_000
export const PING_PROMPT = 'Reply with the single word: warm'

export const KEYS = {
  guard: 'cache.guard',
  always: 'cache.always',
  ttls: 'cache.ttls',
  deadline: (session: string) => `cache.deadline:${session}`,
  every: (session: string) => `cache.every:${session}`,
}

export function initialCache(): CacheState {
  return {
    lastRequestAt: 0, model: '', ctx: 0, isCompacted: false, isForcedCold: false, engineUsd: null, ttls: {}, guard: 'hold',
    ackedAt: 0, isPaying: false, held: null, misses: [], deadline: 0, every: 0, isAlways: false, lastPing: null, stopped: '',
    turn: { gapMs: 0, prevCtx: 0, first: null, isOpen: false }, isConflicted: false, now: 0,
  }
}

// ---- Words and numbers -----------------------------------------------------------------------------

/** "6h", "90m", "1h30m" → ms; anything else null. */
export function parseDuration(text: string): number | null {
  const match = /^(?:(\d+)h)?(?:(\d+)m)?$/.exec(text.trim().toLowerCase())
  if (!match || (match[1] === undefined && match[2] === undefined)) return null
  return (Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0)) * 60_000
}

/** "6h38m", "12m", "2d 3h". */
export function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 60_000))
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  if (hours >= 48) return `${Math.floor(hours / 24)}d ${hours % 24}h`
  return hours > 0 ? `${hours}h${String(minutes).padStart(2, '0')}m` : `${minutes}m`
}

export const fmtUsd = (usd: number | null) => (usd === null ? 'n/a' : `$${usd >= 100 ? usd.toFixed(0) : usd.toFixed(2)}`)
export const fmtTok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))
export const fmtRate = (rate: number) => `$${Number.isInteger(rate) ? rate : rate.toFixed(2)}/MTok`

// ---- The cache -------------------------------------------------------------------------------------

export const ttlOf = (state: CacheState): CacheTtl => state.ttls[state.model] ?? '1h'
export const everyOf = (state: CacheState) => state.every || PING_AFTER_MS[ttlOf(state)]

export function isCold(state: CacheState, now: number): boolean {
  if (state.isCompacted || state.lastRequestAt <= 0) return false
  return state.isForcedCold || now - state.lastRequestAt >= TTL_MS[ttlOf(state)]
}

const rates = (state: CacheState) => cacheRates(state.model, ttlOf(state), { input_tokens: state.ctx })

/** A send now: the engine's estimate when it gave one, else the context at the cache-write price. */
export function coldUsd(state: CacheState): number | null {
  if (state.engineUsd !== null) return state.engineUsd
  const rate = rates(state)
  return rate ? (state.ctx * rate.write) / 1e6 : null
}

/** What the same turn costs on a warm cache. */
export function warmUsd(state: CacheState): number | null {
  const rate = rates(state)
  return rate ? (state.ctx * rate.read) / 1e6 : null
}

/** Everything a ping bills: the cache read, any write, uncached input and the reply. */
export function pingUsd(state: CacheState, usage: Required<Usage>): number | null {
  const rate = cacheRates(state.model, ttlOf(state), usage)
  if (!rate) return null
  return (usage.cache_read_input_tokens * rate.read + usage.cache_creation_input_tokens * rate.write +
    usage.input_tokens * rate.input + usage.output_tokens * rate.output) / 1e6
}

/** Pings at the read price that cost as much as one cold write. */
export function breakEven(state: CacheState): number | null {
  const rate = rates(state)
  return rate && rate.read > 0 && state.ctx > 0 ? Math.floor(rate.write / rate.read) : null
}

/** How long ago it went cold. */
export function coldFor(state: CacheState, now: number): number {
  return state.isForcedCold ? now - state.lastRequestAt : Math.max(0, now - state.lastRequestAt - TTL_MS[ttlOf(state)])
}

// ---- The guard -------------------------------------------------------------------------------------

export type Prompt = { text: string; originKind: string; hasAttachments: boolean; isRunning: boolean }

export type Guarded =
  | { kind: 'pass' }
  /** Sent again while held: it goes through and pays. */
  | { kind: 'bypass' }
  /** `guard warn`: it goes through, with this line in the transcript. */
  | { kind: 'warn'; line: string }
  | { kind: 'hold'; held: CacheHeld; drop: string }

/** What happens to a message you send. Plugins' prompts, commands and anything mid-turn always pass. */
export function guard(state: CacheState, prompt: Prompt, now: number): Guarded {
  if (state.isConflicted || prompt.originKind === 'plugin' || prompt.isRunning) return { kind: 'pass' }
  const text = prompt.text.trim()
  if (!text || text.startsWith('/')) return { kind: 'pass' }
  if (!isCold(state, now) || state.ctx < BIG_TOKENS) return { kind: 'pass' }
  const held: CacheHeld = {
    text: prompt.text, at: now, coldForMs: coldFor(state, now), tokens: state.ctx, coldUsd: coldUsd(state), warmUsd: warmUsd(state),
    writeRate: rates(state)?.write ?? null,
  }
  // A pasted image or file can't be sent again from the card, so it goes through with its price shown.
  if (state.guard === 'warn' || prompt.hasAttachments) {
    return { kind: 'warn', line: `Cache Tax: the prompt cache went cold ${fmtDuration(held.coldForMs)} ago, so this re-writes up to ` +
      `${held.tokens.toLocaleString('en-US')} tokens, about ${fmtUsd(held.coldUsd)} (a warm turn ${fmtUsd(held.warmUsd)}). ` +
      'Pay once to send it; /sb-cache warm keeps it warm after, if you want.' }
  }
  if (state.ackedAt === state.lastRequestAt) return { kind: 'bypass' }
  return {
    kind: 'hold', held,
    drop: `Cache Tax: your message is on hold until you choose on the card above the prompt box (cold cache, up to ${fmtUsd(held.coldUsd)}).` +
      ' Send it again to pay and send it now.',
  }
}

export function onHold(state: CacheState, held: CacheHeld): CacheState {
  return { ...state, held, ackedAt: state.lastRequestAt }
}

/** It goes through knowingly (Pay and send, a resend, `guard warn`): the turn's write is counted. */
export const onPay = (state: CacheState): CacheState => ({ ...state, held: null, ackedAt: 0, isPaying: true })

// ---- Turns -----------------------------------------------------------------------------------------

/** A main-thread request is about to go out: the first of a turn notes the gap that teaches the TTL. */
export function onRequest(state: CacheState, now: number): CacheState {
  const turn = state.turn.isOpen ? state.turn
    : { gapMs: state.lastRequestAt > 0 ? now - state.lastRequestAt : 0, prevCtx: state.ctx, first: null, isOpen: true }
  return { ...state, lastRequestAt: now, turn }
}

/** That request's usage: the first of a turn is kept (the rest only read what it wrote). */
export function onResponse(state: CacheState, usage: Usage, model: string): CacheState {
  const next = { ...state, model: model || state.model, isForcedCold: false, engineUsd: null }
  if (state.turn.first) return next
  return { ...next, turn: { ...state.turn, first: { read: usage.cache_read_input_tokens ?? 0, write: usage.cache_creation_input_tokens ?? 0 } } }
}

/**
 * What a gap between 5 and 60 minutes proves: the first request read most of the context (1 hour) or
 * re-wrote it (5 minutes). Anything else proves nothing.
 */
export function learnedTtl(turn: CacheState['turn']): CacheTtl | null {
  const first = turn.first
  if (!first || turn.prevCtx < MISS_FLOOR || turn.gapMs <= TTL_MS['5m'] || turn.gapMs >= TTL_MS['1h']) return null
  if (first.read >= 0.5 * turn.prevCtx) return '1h'
  if (first.write >= 0.5 * turn.prevCtx) return '5m'
  return null
}

export type TurnDone = { state: CacheState; miss: CacheMiss | null; learned: CacheTtl | null }

/**
 * A main-thread turn ended. The context is the engine's live figure (the summed usage is the fallback);
 * a turn that re-wrote at least half of a context over 20k, or one you paid for, is a cold write.
 */
export function onTurnDone(state: CacheState, usage: (Usage & { model?: string }) | undefined, live: number, durationMs: number, now: number): TurnDone {
  let next: CacheState = { ...state, isCompacted: false, ackedAt: 0, held: null, isPaying: false, turn: { ...state.turn, isOpen: false } }
  // turn.step stamps each request; a turn with none (an engine that streams no steps) is floored at its end.
  if (now - next.lastRequestAt > durationMs) next.lastRequestAt = now
  if (!usage) return { state: next, miss: null, learned: null }
  if (usage.model) next.model = usage.model
  const write = usage.cache_creation_input_tokens ?? 0
  const prev = state.ctx
  next.ctx = live > 0 ? live : (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + write
  const learned = learnedTtl(state.turn)
  if (learned && next.model) next.ttls = { ...next.ttls, [next.model]: learned }
  const isMiss = (prev > MISS_FLOOR && write >= 0.5 * prev) || state.isPaying
  if (!isMiss) return { state: next, miss: null, learned }
  const rate = cacheRates(next.model, ttlOf(next), usage)
  const miss = { at: now, tokens: write, usd: rate ? (write * rate.write) / 1e6 : null }
  next = { ...next, misses: [...next.misses, miss].slice(-50) }
  return { state: next, miss, learned }
}

/** A resumed or forked session: the engine says how long ago, how big, and whether it is cold. */
export type Resume = {
  source: string
  model?: string
  context_tokens?: number
  seconds_since_last_response?: number
  prompt_cache_likely_expired?: boolean
  estimated_cache_write_usd?: number
}

export function onResume(state: CacheState, e: Resume, now: number): { state: CacheState; line: string } {
  if (e.source !== 'resume' && e.source !== 'fork') return { state, line: '' }
  const next: CacheState = { ...state, isCompacted: false }
  if (typeof e.context_tokens === 'number' && e.context_tokens > 0) next.ctx = e.context_tokens
  if (typeof e.seconds_since_last_response === 'number') next.lastRequestAt = now - e.seconds_since_last_response * 1000
  if (e.model) next.model = e.model
  if (e.prompt_cache_likely_expired !== true) return { state: next, line: '' }
  next.isForcedCold = true
  next.engineUsd = typeof e.estimated_cache_write_usd === 'number' ? e.estimated_cache_write_usd : null
  if (next.ctx < BIG_TOKENS) return { state: next, line: '' }
  return { state: next, line: `Cache Tax: resuming cold. The first message re-writes ${next.ctx.toLocaleString('en-US')} tokens, about ` +
    `${fmtUsd(coldUsd(next))}. /clear and paste a summary if you only need the conclusions.` }
}

/** The model changed: its cache starts cold, at the engine's price for the new model. */
export type Switch = { to_model: string; cache_ttl: CacheTtl; context_tokens: number; estimated_cache_write_usd: number }

export function onModelSwitch(state: CacheState, e: Switch): CacheState {
  const next: CacheState = { ...state, model: e.to_model, ttls: { ...state.ttls, [e.to_model]: e.cache_ttl } }
  if (e.context_tokens > 0) next.ctx = e.context_tokens
  if (state.lastRequestAt <= 0 || next.ctx <= 0) return next
  return { ...next, isForcedCold: true, engineUsd: e.estimated_cache_write_usd, ackedAt: 0 }
}

/** Compaction replaces the context: nothing to price until the next turn. */
export const onCompact = (state: CacheState): CacheState => ({ ...state, isCompacted: true, ctx: 0, ackedAt: 0, held: null, isForcedCold: false, engineUsd: null })

/** /clear: a new conversation in the same session; nothing priced before it exists. */
export function onClear(state: CacheState): CacheState {
  return { ...initialCache(), ttls: state.ttls, guard: state.guard, isAlways: state.isAlways, isConflicted: state.isConflicted, model: state.model, now: state.now }
}

// ---- Keep-warm -------------------------------------------------------------------------------------

export function arm(state: CacheState, windowMs: number, every: number, now: number): CacheState {
  return { ...state, deadline: now + windowMs, every, stopped: '' }
}

export const disarm = (state: CacheState, why = ''): CacheState => ({ ...state, deadline: 0, every: 0, stopped: why })

export type Next = { kind: 'ping'; inMs: number } | { kind: 'wait'; inMs: number } | { kind: 'off' }

/**
 * When the next timer fires. Warm: a ping one period after the last request (never past going cold or
 * the deadline). Cold, compacted or before any turn: no ping, only the deadline's cleanup.
 */
export function nextTimer(state: CacheState, now: number): Next {
  if (!state.deadline) return { kind: 'off' }
  if (now >= state.deadline) return { kind: 'wait', inMs: 0 }
  if (state.lastRequestAt > 0 && !state.isCompacted && !isCold(state, now)) {
    const untilCold = state.lastRequestAt + TTL_MS[ttlOf(state)] - now
    return { kind: 'ping', inMs: Math.min(state.deadline - now, untilCold, Math.max(1000, state.lastRequestAt + everyOf(state) - now)) }
  }
  return { kind: 'wait', inMs: state.deadline - now }
}

export type PingCheck = { kind: 'send' } | { kind: 'stop'; why: string } | { kind: 'later' } | { kind: 'skip' }

/**
 * A ping timer fired: send it, stop (the deadline passed, or the cache went cold while the computer
 * slept), try again in a minute (rate limits nearly used up), or skip (a request since moved the clock).
 */
export function pingCheck(state: CacheState, now: number, isNearLimit: boolean): PingCheck {
  if (!state.deadline || now >= state.deadline) return { kind: 'stop', why: '' }
  if (state.lastRequestAt > 0 && isCold(state, now)) return { kind: 'stop', why: 'the cache went cold while the computer slept' }
  if (now - state.lastRequestAt < everyOf(state) - 1000) return { kind: 'skip' }
  if (isNearLimit) return { kind: 'later' }
  return { kind: 'send' }
}

export type Reply = { isAnswered: true; usage: Usage } | { isAnswered: false; reason: string; status?: number | null; message?: string }

/** A ping came back: warm (it read the prefix and wrote little) moves the clock; anything else stops. */
export function onPing(state: CacheState, reply: Reply, now: number): { state: CacheState; stop: string } {
  if (!reply.isAnswered) {
    const why = reply.reason === 'nothing-to-fork' ? 'no conversation to warm yet'
      : reply.reason === 'api-error' ? `the API call failed${reply.status ? ` (${reply.status})` : ''}`
      : reply.reason === 'aborted' ? 'the ping was interrupted'
      : reply.reason === 'failed' ? `the ping failed${reply.message ? `: ${reply.message}` : ''}` : 'the ping came back empty'
    return { state: disarm(state, why), stop: why }
  }
  const usage = {
    input_tokens: reply.usage.input_tokens ?? 0, output_tokens: reply.usage.output_tokens ?? 0,
    cache_read_input_tokens: reply.usage.cache_read_input_tokens ?? 0, cache_creation_input_tokens: reply.usage.cache_creation_input_tokens ?? 0,
  }
  const usd = pingUsd(state, usage)
  const isWarm = usage.cache_read_input_tokens > 0 && usage.cache_creation_input_tokens < 0.1 * usage.cache_read_input_tokens
  const lastPing = { at: now, read: usage.cache_read_input_tokens, write: usage.cache_creation_input_tokens, usd, isWarm }
  if (!isWarm) {
    const why = `the ping read ${fmtTok(lastPing.read)} and wrote ${fmtTok(lastPing.write)} tokens (${fmtUsd(usd)}), so the cache was already gone`
    return { state: { ...disarm(state, why), lastPing }, stop: why }
  }
  return { state: { ...state, lastPing, lastRequestAt: now }, stop: '' }
}

// ---- What it says ----------------------------------------------------------------------------------

/** "keep-warm 5h12m left · ping in 32m · last ping read 182k $0.04". */
export function warmText(state: CacheState, now: number): string {
  if (!state.deadline) return state.stopped ? `keep-warm stopped: ${state.stopped}` : ''
  const ping = state.lastPing ? ` · last ping read ${fmtTok(state.lastPing.read)} ${fmtUsd(state.lastPing.usd)}` : ''
  const next = !state.lastRequestAt ? ' · waiting for the first turn'
    : state.isCompacted ? ' · waiting for the first turn after compaction'
    : isCold(state, now) ? ` · cold now, first ping ${fmtDuration(everyOf(state))} after the next turn`
    : ` · ping in ${fmtDuration(state.lastRequestAt + everyOf(state) - now)}`
  return `keep-warm ${fmtDuration(state.deadline - now)} left${next}${ping}`
}

/** The one line the Switchboard pane shows for Cache Tax. */
export function statusLine(state: CacheState, now: number): string {
  if (state.isConflicted) return 'cache-tax is installed; use one'
  if (state.held) return 'a message is on hold'
  if (state.deadline) return `keep-warm ${fmtDuration(state.deadline - now)}`
  if (!state.lastRequestAt || state.isCompacted) return 'watching'
  return isCold(state, now) ? 'cold' : 'warm'
}

/** /sb-cache: the cache, its prices, keep-warm and the guard, one fact a line. */
export function statusCard(state: CacheState, now: number): string {
  const lines = [`Cache Tax · ${state.model ? modelName(state.model) : 'model not seen yet'} · ${ttlOf(state) === '5m' ? '5-minute' : '1-hour'} cache` +
    `${state.ttls[state.model] ? '' : ' (assumed until seen)'}`]
  const row = (label: string, value: string) => lines.push(`${label.padEnd(11)} ${value}`)
  if (state.isCompacted) row('state', 'reset by compaction, waiting for the first turn')
  else if (!state.lastRequestAt) row('state', 'no request yet this session')
  else if (isCold(state, now)) row('state', `cold, last request ${fmtDuration(now - state.lastRequestAt)} ago`)
  else row('state', `warm, ${fmtDuration(state.lastRequestAt + TTL_MS[ttlOf(state)] - now)} left`)
  row('context', `${state.ctx.toLocaleString('en-US')} tokens`)
  row('cold cost', `${fmtUsd(coldUsd(state))} to re-write it (warm turn ${fmtUsd(warmUsd(state))})`)
  const pings = breakEven(state)
  if (pings !== null) row('break-even', `up to ${pings} pings at the read price cost one cold write, about ${fmtDuration(pings * everyOf(state))} of idle`)
  const warm = warmText(state, now)
  row('keep-warm', (warm ? warm.replace(/^keep-warm /, state.deadline ? 'on, ' : '') : 'off (/sb-cache warm 6h to arm it)') + (state.isAlways ? ' · always' : ''))
  row('guard', state.guard === 'hold' ? 'hold a cold send on a card (/sb-cache guard warn to only show the price)'
    : 'warn only (/sb-cache guard hold to hold a cold send)')
  const paid = state.misses.reduce((sum, miss) => sum + (miss.usd ?? 0), 0)
  row('session', `${state.misses.length} cold write${state.misses.length === 1 ? '' : 's'} paid, ${fmtUsd(paid)}`)
  return lines.join('\n')
}
