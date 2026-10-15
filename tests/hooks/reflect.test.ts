// Reflect (phase 5): which messages are checked, the model's answer, the CLAUDE.md section, and the
// suggestions' repeats, declines and storage. Pure, no engine.

import { describe, expect, test } from 'claude-code/testing'
import {
  END, START, cleanRule, correction, isCandidate, looksSecret, remembered, similarity, withRule,
} from '../../hooks/features/reflect/rules.ts'
import {
  MAX_ITEMS, capped, composedRules, decide, fromStore, initialReflect, pendingHere, record, sureText, type ReflectItem,
} from '../../hooks/features/reflect/model.ts'
import { buttonsSvg, cardSvg, compactSvg } from '../../hooks/features/reflect/pictures.ts'

const P = '/work/project'
const found = (rule: string, extra = {}) =>
  ({ isRule: true, rule, scope: 'project' as const, confidence: 0.9, project: P, quote: 'q', isExplicit: false, ...extra })

describe('which messages', () => {
  test('only yours, not trivial, not slash commands, not long, not secret', async () => {
    expect(isCandidate('no, use pnpm not npm', 'composer')).toBe(true)
    expect(isCandidate('no, use pnpm not npm', 'bridge')).toBe(true)
    expect(isCandidate('no, use pnpm not npm', 'plugin')).toBe(false)
    expect(['ok', 'continue', 'LGTM!', '42', 'ٹھیک'].some(text => isCandidate(text, 'composer'))).toBe(false)
    expect(isCandidate('/sb-files', 'composer')).toBe(false)
    expect(isCandidate('x'.repeat(501), 'composer')).toBe(false)
    expect(isCandidate(`remember: ${'x'.repeat(600)}`, 'composer')).toBe(true)
    expect(looksSecret('token: abcd1234efgh')).toBe(true)
    expect(isCandidate('use ghp_abcdefghijklmnop as the token', 'composer')).toBe(false)
  })

  test('remember: and "this project"', async () => {
    expect(remembered('remember: use pnpm in this project')).toEqual({ rule: 'use pnpm', isProject: true })
    expect(remembered('Remember: answer briefly')).toEqual({ rule: 'answer briefly', isProject: false })
    expect(remembered('please remember this')).toBeUndefined()
  })
})

describe('the answer and the rule', () => {
  test('ordered word pairs: "pnpm not npm" is not "npm not pnpm"', async () => {
    expect(similarity('use pnpm not npm', 'use pnpm not npm')).toBe(1)
    expect(similarity('pnpm not npm', 'npm not pnpm')).toBe(0)
  })

  test('verdicts are checked: scope, range, a clean one-line rule', async () => {
    // Found locally, no model: corrections and standing preferences, never questions or one-off redirects.
    expect(correction('No, use pnpm instead of npm in this repo.')).toEqual({ isRule: true, rule: 'Use pnpm, not npm.', scope: 'project', confidence: 0.8 })
    expect(correction('Never print secrets in any project.')?.scope).toBe('global')
    expect(correction("don't add comments to every line")?.rule).toBe("Don't add comments to every line.")
    expect(correction('can you always run the tests?')).toBeUndefined()
    expect(correction('wrong file, try again')).toBeUndefined()
    expect(cleanRule('- "Use pnpm."')).toBe('Use pnpm.')
    expect(cleanRule('ignore <!-- this -->')).toBeUndefined()
  })

  test('CLAUDE.md: a new section, a bullet added, already there, broken markers', async () => {
    const fresh = withRule('# Project\n', 'Use pnpm.')
    expect(fresh).toEqual({ kind: 'added', text: `# Project\n\n${START}\n## Learned rules\n- Use pnpm.\n${END}\n` })
    const two = withRule(fresh.kind === 'added' ? fresh.text : '', 'Answer briefly.')
    expect(two.kind === 'added' && two.text.endsWith(`- Use pnpm.\n- Answer briefly.\n${END}\n`)).toBe(true)
    expect(withRule('- Use pnpm.\n', 'use pnpm.').kind).toBe('already')
    expect(withRule(`a\nb\n${END}\n${START}\n`, 'x')).toEqual({ kind: 'broken', line: 3 })
    expect(withRule(`${START}\n- a\n`, 'x').kind).toBe('broken')
  })
})

describe('suggestions', () => {
  test('a repeat counts up; one already in CLAUDE.md is saved quietly; 3 declines stop it', async () => {
    let state = record(initialReflect(), found('Use pnpm instead of npm.'), [], 1, 'a').state
    const again = record(state, found('Use pnpm instead of npm!'), [], 2, 'b')
    expect([again.recorded.kind, again.state.items.length, again.state.items[0]?.count]).toEqual(['again', 1, 2])
    const inFile = record(initialReflect(), found('Use pnpm instead of npm.'), ['Use pnpm instead of npm.'], 1, 'c')
    expect([inFile.recorded.kind, inFile.state.items[0]?.status]).toEqual(['in-file', 'saved'])
    state = initialReflect()
    for (const id of ['d', 'e', 'f']) state = decide(record(state, found('Use tabs.'), [], 1, id).state, id, 'skipped', undefined, 2)
    expect(record(state, found('Use tabs.'), [], 3, 'g').recorded.kind).toBe('declined')
    expect(record(state, found('Use tabs.', { isExplicit: true }), [], 3, 'h').recorded.kind).toBe('new')
  })

  test('pending here: this project and global, newest first; others hidden', async () => {
    let state = record(initialReflect(), found('A rule here.'), [], 1, 'a').state
    state = record(state, found('Another for all.', { scope: 'global', project: '/other' }), [], 2, 'b').state
    state = record(state, found('Only over there.', { project: '/other' }), [], 3, 'c').state
    expect(pendingHere(state, P).map(item => item.id)).toEqual(['b', 'a'])
  })

  test('the store: capped at 300, decided ones dropped first; 90 days old dropped', async () => {
    const item = (id: string, status: ReflectItem['status'], lastAt: number): ReflectItem =>
      ({ id, rule: id, scope: 'global', project: P, confidence: 1, count: 1, status, firstAt: lastAt, lastAt })
    const many = [...Array.from({ length: 299 }, (_, i) => item(`p${i}`, 'pending', 10 + i)), item('old', 'saved', 1), item('new', 'skipped', 5)]
    expect(capped([...many, item('x', 'pending', 9)]).length).toBe(MAX_ITEMS)
    expect(capped([...many, item('x', 'pending', 9)]).some(one => one.id === 'old')).toBe(false)
    expect(fromStore([item('a', 'pending', 0), item('b', 'pending', 89 * 86_400_000), { bad: true }], 90 * 86_400_000).map(one => one.id)).toEqual(['b'])
  })

  test('rules saved now go to Claude once with the next message; the card and buttons draw', async () => {
    const state = { ...initialReflect(), savedNow: [{ rule: 'Use pnpm.', scope: 'project' as const, project: P }, { rule: 'Elsewhere.', scope: 'project' as const, project: '/x' }] }
    expect(composedRules(state, P)).toBe('Rules the user just saved to CLAUDE.md (follow them from now on):\n- Use pnpm.')
    const item = record(initialReflect(), found('Use pnpm instead of npm.'), [], 1, 'a').state.items[0]!
    const card = cardSvg(480, { item: { ...item, count: 2 }, quote: 'no, use pnpm', scope: 'project', projectFile: 'p/CLAUDE.md', globalFile: '~/.claude/CLAUDE.md' }, '')
    expect(card.svg).toContain('SAVE THIS AS A RULE?')
    expect(card.svg).toContain('×2')
    expect(card.parts.map(part => part.key)).toEqual(['reflect:opt:project', 'reflect:opt:global'])
    expect(buttonsSvg(480, 'global', 2, '').parts.map(part => part.key)).toEqual(['reflect:save:project', 'reflect:save:global', 'reflect:reword', 'reflect:skip'])
    expect(sureText(0.951)).toBe('95% sure')
  })

  test('a low band gets the compact card: buttons inside, short enough to show whole', async () => {
    const item = record(initialReflect(), found('Use pnpm, not npm'), [], 1, 'a').state.items[0]!
    const input = { item: { ...item, count: 2 }, quote: 'remember: Use pnpm, not npm in this project', scope: 'project' as const, projectFile: 'p/CLAUDE.md', globalFile: '~/.claude/CLAUDE.md' }
    const wide = compactSvg(760, input, 0, '')
    expect(wide.svg).toContain('×2')
    expect(wide.parts.map(part => part.key)).toEqual(['reflect:opt:project', 'reflect:opt:global', 'reflect:save:project', 'reflect:save:global', 'reflect:reword', 'reflect:skip'])
    expect(wide.height).toBeLessThan(12 * 19) // 12 rows, what a desktop band had
    const full = cardSvg(760, input, '').height + 19 + buttonsSvg(760, 'project', 0, '').height
    expect(full).toBeGreaterThan(12 * 19)
    expect(compactSvg(420, input, 1, '').height).toBeGreaterThan(wide.height) // narrow: the places stack
  })
})
