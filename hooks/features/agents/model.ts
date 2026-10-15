// Agents (screen F1): display only. Switchboard starts no agents and calls no model for this; it
// watches the subagents Claude runs (`agent.spawn`, `turn.step`, `turn.complete`, `$.agent.list()`)
// and draws them. Runs started in one turn are one group, titled from that turn's prompt.
// The tracking follows savvy-progress (claude-kit), MIT License, Copyright (c) 2026 johnnyvizz:
// rounds by description, context from the latest step, cost from step usage. Added: groups, nested
// runs, teammates, four end states, and rebuilding from `$.agent.list()`.

import type { AgentRun, AgentRunStatus, AgentsState } from '../../../types/index.d.ts'
import { costOf, tokensOf, windowOf, type Usage } from '../../core/prices.ts'

export type { AgentRun, AgentsState }

/** How each run looks: from the model and effort it actually ran with (its crab and color). */
export type Look = 'fable' | 'heavy' | 'careful' | 'medium' | 'light' | 'explore'

const MAX_RUNS = 200

export function initialAgents(): AgentsState {
  return { group: '', title: '', groupStartedAt: 0, runs: [], now: 0, isFinishedOpen: true, hiddenGroup: '', sessionCost: -1 }
}

/** Case, spaces and punctuation don't matter when a retry is matched to its first round. */
export const norm = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** Explore is the pirate; then Fable, Haiku or low effort, xhigh/max, high, and the rest. */
export function lookOf(run: Pick<AgentRun, 'type' | 'model' | 'effort'>): Look {
  if (/^(.*:)?explore$/i.test(run.type)) return 'explore'
  const model = run.model.toLowerCase()
  const effort = String(run.effort ?? '')
  if (/fable|mythos/.test(model)) return 'fable'
  if (/haiku/.test(model) || effort === 'low') return 'light'
  if (effort === 'xhigh' || effort === 'max') return 'heavy'
  if (effort === 'high') return 'careful'
  return 'medium'
}

/** A group's title from the prompt that started it: its first sentence, a few words. */
export function titleOf(prompt: string): string {
  const first = prompt.replace(/^\/\S+\s*/, '').split(/(?<=[.!?])\s|\n/)[0]?.trim() ?? ''
  const words = first.split(/\s+/).filter(Boolean)
  const short = words.slice(0, 6).join(' ')
  return short ? (words.length > 6 ? `${short}…` : short).replace(/^./, char => char.toUpperCase()) : 'Agents'
}

export type Spawned = { id: string; type: string; description: string; model: string; parentId?: string; isTeammate?: boolean }

/** A run started. The first one in a new turn starts a new group; finished runs of older groups go. */
export function onSpawn(state: AgentsState, spawned: Spawned, turn: { id: string; prompt: string }, now: number): AgentsState {
  const isNewGroup = turn.id !== state.group
  const kept = isNewGroup ? state.runs.filter(run => run.status === 'running') : state.runs
  const round = 1 + kept.filter(run => spawned.description && norm(run.description) === norm(spawned.description)).length
  const run: AgentRun = {
    id: spawned.id, type: spawned.type, description: spawned.description || spawned.type, model: spawned.model,
    status: 'running', startedAt: now, contextTokens: 0, contextMax: windowOf(spawned.model), tokens: 0, costUsd: 0, steps: 0, round,
    group: turn.id, ...(spawned.parentId ? { parentId: spawned.parentId } : {}), ...(spawned.isTeammate ? { isTeammate: true } : {}),
  }
  // A retry keeps one row: the earlier round leaves once the new one starts.
  const others = kept.filter(one => one.id !== run.id &&
    !(round > 1 && one.status !== 'running' && norm(one.description) === norm(run.description)))
  return {
    ...state, runs: [...others, run].slice(-MAX_RUNS), now: Math.max(state.now, now),
    ...(isNewGroup ? { group: turn.id, title: titleOf(turn.prompt), groupStartedAt: now } : {}),
  }
}

const mapRun = (state: AgentsState, id: string, change: (run: AgentRun) => AgentRun): AgentsState => {
  if (!state.runs.some(run => run.id === id)) return state
  return { ...state, runs: state.runs.map(run => (run.id === id ? change(run) : run)) }
}

const addCost = (total: number, cost: number | null) => (total < 0 || cost === null ? -1 : total + cost)

/** One model request of a subagent: its context now, and the tokens and cost so far. */
export function onUsage(state: AgentsState, id: string, model: string, effort: string | undefined, usage: Usage): AgentsState {
  return mapRun(state, id, run => ({
    ...run, model, ...(effort ? { effort } : {}),
    contextTokens: tokensOf(usage), contextMax: windowOf(model),
    tokens: run.tokens + tokensOf(usage), costUsd: addCost(run.costUsd, costOf(model, usage)), steps: run.steps + 1,
  }))
}

/** The run's turn ended: answered, stopped, refused or errored. A run with no steps seen takes the turn's own usage. */
export function onComplete(state: AgentsState, id: string, reason: string, now: number, usage?: Usage & { model?: string }): AgentsState {
  const status: AgentRunStatus = reason === 'answer' ? 'done' : reason === 'aborted' ? 'stopped' : 'failed'
  return mapRun(state, id, run => {
    const model = usage?.model || run.model
    const fallback = run.steps === 0 && usage
      ? { model, tokens: tokensOf(usage), costUsd: costOf(model, usage) ?? -1, contextTokens: tokensOf(usage) } : {}
    return { ...run, ...fallback, status, endedAt: now, ...(status === 'failed' ? { failure: reason === 'refusal' ? 'refused' : 'error' } : {}) }
  })
}

export type ListedAgent = { id: string; type: string; description: string; status: string; parentId?: string; teammateId?: string }

/**
 * `$.agent.list()` after a reload, a resume or a compaction: runs it lists that we lost come back, and
 * runs that ended while we weren't watching take their end state.
 */
export function fromList(state: AgentsState, listed: readonly ListedAgent[], now: number): AgentsState {
  const ended: Record<string, AgentRunStatus> = { completed: 'done', failed: 'failed', killed: 'stopped' }
  const runs = state.runs.map(run => {
    const seen = listed.find(one => one.id === run.id)
    const status = seen ? ended[seen.status] : undefined
    return status && run.status === 'running' ? { ...run, status, endedAt: now } : run
  })
  for (const one of listed) {
    if (runs.some(run => run.id === one.id)) continue
    const status = ended[one.status] ?? 'running'
    if (status !== 'running') continue // only what still runs comes back; finished ones from before stay gone
    runs.push({
      id: one.id, type: one.type, description: one.description || one.type, model: '', status, startedAt: now,
      contextTokens: 0, contextMax: 1_000_000, tokens: 0, costUsd: -1, steps: 0, round: 1, group: state.group,
      ...(one.parentId ? { parentId: one.parentId } : {}), ...(one.teammateId ? { isTeammate: true } : {}),
    })
  }
  return { ...state, runs: runs.slice(-MAX_RUNS) }
}

// ---- what the screens show ----------------------------------------------------------------------

export const isRunning = (state: AgentsState) => state.runs.some(run => run.status === 'running')

/** Runs in the order the pane lists them: parents before their children. */
export function ordered(runs: readonly AgentRun[]): (AgentRun & { depth: number })[] {
  const out: (AgentRun & { depth: number })[] = []
  const ids = new Set(runs.map(run => run.id))
  const walk = (parent: string | undefined, depth: number) => {
    for (const run of runs) {
      const isRoot = parent === undefined && (!run.parentId || !ids.has(run.parentId))
      if (isRoot || (parent !== undefined && run.parentId === parent)) {
        out.push({ ...run, depth })
        walk(run.id, depth + 1)
      }
    }
  }
  walk(undefined, 0)
  return out
}

/** The tiles: cost (the session's /cost figure when known, else the runs' estimate), tokens, time. */
export function totals(state: AgentsState): { cost: number; isExact: boolean; tokens: number; time: number } {
  const runs = state.runs
  const tokens = runs.reduce((sum, run) => sum + run.tokens, 0)
  const start = runs.length ? Math.min(...runs.map(run => run.startedAt)) : state.now
  const end = isRunning(state) ? state.now : Math.max(start, ...runs.map(run => run.endedAt ?? state.now))
  const time = Math.max(0, end - start)
  if (state.sessionCost >= 0) return { cost: state.sessionCost, isExact: true, tokens, time }
  const cost = runs.reduce((sum, run) => (sum < 0 || run.costUsd < 0 ? -1 : sum + run.costUsd), 0)
  return { cost, isExact: false, tokens, time }
}

export const fmtTokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`)
export const fmtCost = (usd: number) => (usd < 0 ? '?' : `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(1)}`)
export function fmtTime(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = String(seconds % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

export const elapsed = (run: AgentRun, now: number) => (run.endedAt ?? Math.max(now, run.startedAt)) - run.startedAt
export const contextPercent = (run: AgentRun) => Math.round((100 * run.contextTokens) / Math.max(1, run.contextMax))

/** The bar under a row: full in its color once done; while it runs, its context use, in grey. */
export function barOf(run: AgentRun): { fraction: number; isColored: boolean } {
  if (run.status === 'done') return { fraction: 1, isColored: true }
  return { fraction: Math.min(1, run.contextTokens / Math.max(1, run.contextMax)), isColored: false }
}

export type BandSummary = {
  title: string
  /** 0..1 of the group's runs finished. */
  fraction: number
  /** "2/4 done". */
  label: string
  running: number
  total: number
  /** The latest running run's look: its crab rides at the end of the bar. */
  look: Look
}

/** The status row's Agents part while any of the group runs, unless you hid it (✕). */
export function bandOf(state: AgentsState): BandSummary | null {
  const group = state.runs.filter(run => run.group === state.group)
  const running = group.filter(run => run.status === 'running')
  if (!running.length || state.hiddenGroup === state.group) return null
  const finished = group.length - running.length
  return {
    title: state.title || 'Agents', fraction: group.length ? finished / group.length : 0, label: `${finished}/${group.length} done`,
    running: running.length, total: group.length, look: lookOf(running[running.length - 1]!),
  }
}

/** Opens by itself while any subagent runs (and the setting is on): your spec, 2026-10-12. */
export const shouldAutoOpen = (state: AgentsState) => state.runs.some(run => run.status === 'running')

/** The one line the Switchboard pane shows for Agents. */
export function statusLine(state: AgentsState): string {
  const running = state.runs.filter(run => run.status === 'running').length
  return running ? `${running} running` : state.runs.length ? `${state.runs.length} finished` : 'idle'
}
