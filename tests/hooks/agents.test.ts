// Agents (phase 4): tracking, looks, totals and the pictures. Pure, no engine.

import { describe, expect, test } from 'claude-code/testing'
import { costOf, modelName, priceOf } from '../../hooks/core/prices.ts'
import {
  bandOf, fmtCost, fmtTime, fmtTokens, fromList, initialAgents, lookOf, onComplete, onSpawn, onUsage, ordered, titleOf, totals,
  type AgentsState,
} from '../../hooks/features/agents/model.ts'
import { bandSvg, headerSvg, runSvg } from '../../hooks/features/agents/pictures.ts'

const turn = { id: 't1', prompt: '/sb-agents Refactor the auth middleware: move sessions. Then review.' }
const spawn = (state: AgentsState, id: string, description: string, now = 1_000, extra = {}) =>
  onSpawn(state, { id, type: 'general-purpose', description, model: 'claude-opus-5-5', ...extra }, turn, now)
const usage = { input_tokens: 1_000, output_tokens: 500, cache_read_input_tokens: 20_000, cache_creation_input_tokens: 2_000 }

describe('prices', () => {
  test('from the price list: Opus 5.5, Fable 5.1, Haiku 5.5 by prompt size, unknown', async () => {
    expect(priceOf('claude-opus-5-5')).toEqual([4, 20, 0.2, 5])
    expect(priceOf('claude-fable-5-1')).toEqual([10, 50, 0.25, 12.5])
    expect(priceOf('claude-haiku-5-5', { input_tokens: 1_000 })).toEqual([0.1, 0.5, 0.01, 0.125])
    expect(priceOf('claude-haiku-5-5', { cache_read_input_tokens: 150_000 })).toEqual([0.5, 2.5, 0.05, 0.625])
    expect(costOf('some-model', usage)).toBeNull()
    expect(Math.round(costOf('claude-opus-5-5', usage)! * 1e6)).toBe(1_000 * 4 + 500 * 20 + 20_000 * 0.2 + 2_000 * 5)
    expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
  })
})

describe('tracking', () => {
  test('a group per turn, titled from its prompt; usage adds up; end states stay apart', async () => {
    let state = spawn(spawn(initialAgents(), 'a', 'Move sessions'), 'b', 'Update routes')
    expect(state.title).toBe('Refactor the auth middleware: move sessions.')
    state = onUsage(state, 'a', 'claude-opus-5-5', 'xhigh', usage)
    state = onUsage(state, 'a', 'claude-opus-5-5', 'xhigh', usage)
    const a = state.runs.find(run => run.id === 'a')!
    expect([a.steps, a.tokens, a.contextTokens, a.effort]).toEqual([2, 47_000, 23_500, 'xhigh'])
    state = onComplete(onComplete(state, 'a', 'answer', 5_000), 'b', 'refusal', 6_000)
    expect(state.runs.map(run => [run.status, run.failure ?? ''])).toEqual([['done', ''], ['failed', 'refused']])
    expect(onComplete(state, 'b', 'aborted', 7_000).runs[1]?.status).toBe('stopped')
  })

  test('a retry with the same description is one row, round 2', async () => {
    let state = onComplete(spawn(initialAgents(), 'a', 'Write the tests'), 'a', 'answer', 2_000)
    state = spawn(state, 'b', 'write the tests!')
    expect(state.runs.map(run => [run.id, run.round])).toEqual([['b', 2]])
  })

  test('a new turn starts a new group; running agents stay', async () => {
    let state = onComplete(spawn(spawn(initialAgents(), 'a', 'One'), 'b', 'Two'), 'a', 'answer', 2_000)
    state = onSpawn(state, { id: 'c', type: 'Explore', description: 'Three', model: 'claude-haiku-5-5' }, { id: 't2', prompt: 'look around' }, 3_000)
    expect([state.group, state.title, state.runs.map(run => run.id)]).toEqual(['t2', 'Look around', ['b', 'c']])
  })

  test('nested runs follow their parent; the list after a reload adds what still runs', async () => {
    let state = spawn(spawn(initialAgents(), 'a', 'Parent'), 'b', 'Child', 1_000, { parentId: 'a' })
    state = spawn(state, 'c', 'Other')
    expect(ordered(state.runs).map(run => `${run.depth}${run.id}`)).toEqual(['0a', '1b', '0c'])
    state = fromList(state, [{ id: 'a', type: 'x', description: 'Parent', status: 'completed' },
      { id: 'z', type: 'Explore', description: 'Back', status: 'running' }, { id: 'old', type: 'x', description: 'Gone', status: 'completed' }], 9_000)
    expect(state.runs.map(run => `${run.id}:${run.status}`)).toEqual(['a:done', 'b:running', 'c:running', 'z:running'])
  })

  test('looks come from model and effort', async () => {
    const look = (model: string, effort?: string, type = 'general-purpose') => lookOf({ type, model, ...(effort ? { effort } : {}) })
    expect([look('claude-fable-5-1'), look('claude-opus-5-5', 'xhigh'), look('claude-opus-5-5', 'high'), look('claude-opus-5-5', 'medium'),
      look('claude-haiku-5-5'), look('claude-opus-5-5', 'low'), look('x', undefined, 'Explore')])
      .toEqual(['fable', 'heavy', 'careful', 'medium', 'light', 'light', 'explore'])
  })

  test('band: while any runs, "1/2 done"; hidden by ✕ for this group only', async () => {
    let state = onComplete(spawn(spawn(initialAgents(), 'a', 'One'), 'b', 'Two'), 'a', 'answer', 2_000)
    expect(bandOf(state)?.label).toBe('1/2 done')
    expect(bandOf({ ...state, hiddenGroup: 't1' })).toBeNull()
    state = onComplete(state, 'b', 'answer', 3_000)
    expect(bandOf(state)).toBeNull()
  })

  test('totals: /cost when known, else the runs; formats', async () => {
    const state = { ...onUsage(spawn(initialAgents(), 'a', 'One'), 'a', 'claude-opus-5-5', 'high', usage), now: 61_000 }
    expect(totals(state).isExact).toBe(false)
    expect(totals({ ...state, sessionCost: 0.33 })).toMatchObject({ cost: 0.33, isExact: true, time: 60_000 })
    expect([fmtTokens(342_000), fmtTokens(1_500_000), fmtCost(0.331), fmtCost(-1), fmtTime(61_000)]).toEqual(['342k', '1.5M', '$0.33', '?', '1:01'])
    expect(titleOf('fix it')).toBe('Fix it')
  })
})

describe('pictures', () => {
  test('header tiles, a run row, the band with its two parts', async () => {
    const state = { ...onUsage(spawn(initialAgents(), 'a', 'Review the change'), 'a', 'claude-opus-5-5', 'xhigh', usage), now: 18_000 }
    expect(headerSvg(480, state).svg).toContain('Tokens')
    const row = runSvg(480, { ...state.runs[0]!, depth: 0 }, state.now, true)
    expect(row).toContain('Review the change')
    expect(row).toContain('Opus 5.5 · xhigh')
    expect(bandSvg(480, bandOf(spawn(state, 'b', 'Two'))!, '').parts.map(part => part.key)).toEqual(['band:agents-hide', 'band:agents'])
  })
})
