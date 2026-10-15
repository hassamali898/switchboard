// Replay (phase 2): the diff, word marks, the readers for tool patches and git diffs, turns and
// storage. Pure, no engine.

import { describe, expect, test } from 'claude-code/testing'
import { counts, diffTexts, hunkLines, myers, parseGitDiff, trimContext, withWords } from '../../hooks/features/replay/diff.ts'
import {
  REPLAY_CAP_BYTES, addSteps, editStep, finishTurn, forStore, fromStore, goTo, headline, initialReplay, notebookStep,
  onTurnStart, showTurn, stepWhere, summaryOf, type ReplayStep,
} from '../../hooks/features/replay/model.ts'
import { editSvg, headerSvg, timelineSvg } from '../../hooks/features/replay/pictures.ts'

const place = (path: string) => ({ path, isOutside: false })
const step = (path: string, at = 1): ReplayStep => editStep('Edit', {
  structuredPatch: [{ lines: [' a', '-greet(name)', '+welcome(name)', ' b'] }],
}, place(path), at)!

describe('diff', () => {
  test('myers finds the shortest script and applies back to the new text', async () => {
    const a = 'ABCABBA'.split('')
    const b = 'CBABAC'.split('')
    const ops = myers(a, b)
    expect(ops.filter(op => op !== '=').length).toBe(5) // the classic example: D = 5
    let i = 0
    let j = 0
    const rebuilt: string[] = []
    for (const op of ops) {
      if (op === '=') {
        rebuilt.push(a[i++]!)
        j++
      } else if (op === '-') i++
      else rebuilt.push(b[j++]!)
    }
    expect(rebuilt.join('')).toBe('CBABAC')
  })

  test('common start and end are kept; only the middle changes', async () => {
    const lines = diffTexts('one\ntwo\nthree\nfour\n', 'one\nTWO\nthree\nfour\n')
    expect(lines.map(line => line.op).join('')).toBe(' -+  ')
    expect(counts(lines)).toEqual({ add: 1, del: 1 })
  })

  test('context is cut to one line around each change, gaps become ~', async () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n')
    const after = before.replace('line 2', 'LINE 2').replace('line 15', 'LINE 15')
    const trimmed = trimContext(diffTexts(before, after))
    expect(trimmed.map(line => line.op).join('')).toBe(' -+ ~ -+ ')
  })

  test('tool patches: hunks in order, ~ between them, "no newline" markers skipped', async () => {
    const lines = hunkLines([{ lines: [' a', '-b', '+c'] }, { lines: ['-x', '\\ No newline at end of file', '+y'] }])
    expect(lines.map(line => `${line.op}${line.text}`)).toEqual([' a', '-b', '+c', '~', '-x', '+y'])
  })

  test('word marks: paired lines mark the changed word; too different shows whole lines', async () => {
    const [old, next] = withWords([{ op: '-', text: '  `greet(name)`' }, { op: '+', text: '  `welcome(name)`' }])
    expect(old?.segments?.filter(one => one.isChanged).map(one => one.text)).toEqual(['greet'])
    expect(next?.segments?.filter(one => one.isChanged).map(one => one.text)).toEqual(['welcome'])
    const [a, b] = withWords([{ op: '-', text: 'const total = 1' }, { op: '+', text: 'return fetchAll(urls)' }])
    expect(a?.segments).toBeUndefined()
    expect(b?.segments).toBeUndefined()
  })

  test('git diff: files, new and deleted, renames, binary', async () => {
    const files = parseGitDiff([
      'diff --git a/src/a.js b/src/a.js', 'index 1..2 100644', '--- a/src/a.js', '+++ b/src/a.js',
      '@@ -1,2 +1,2 @@', ' keep', '-old', '+new', '@@ -9 +9 @@', '-x', '+y',
      'diff --git a/n.txt b/n.txt', 'new file mode 100644', '--- /dev/null', '+++ b/n.txt', '@@ -0,0 +1 @@', '+hi',
      'diff --git a/old.md b/new.md', 'similarity index 90%', 'rename from old.md', 'rename to new.md',
      'diff --git a/img.png b/img.png', 'Binary files a/img.png and b/img.png differ',
    ].join('\n'))
    expect(files.map(file => [file.path, file.kind, file.from ?? ''])).toEqual([
      ['src/a.js', 'edit', ''], ['n.txt', 'created', ''], ['new.md', 'edit', 'old.md'], ['img.png', 'binary', ''],
    ])
    expect(files[0]?.lines.map(line => line.op).join('')).toBe(' -+~-+')
  })
})

describe('steps', () => {
  test('an Edit from its structuredPatch; a Write that creates a file is all added', async () => {
    const one = step('README.md')
    expect([one.add, one.del, one.kind, one.lines.length]).toEqual([1, 1, 'edit', 4])
    const created = editStep('Write', { type: 'create', structuredPatch: [], content: 'a\nb\n' }, place('src/new.js'), 1)
    expect([created?.kind, created?.add, created?.note]).toEqual(['created', 2, 'new file'])
    expect(editStep('Edit', { staged: true, structuredPatch: [{ lines: ['-a', '+b'] }] }, place('x'), 1)).toBeNull()
    expect(stepWhere(one)).toBe('README.md, project root · Edit')
  })

  test('a notebook cell from its sources; you changing the proposal is noted', async () => {
    const cell = notebookStep({ old_source: 'x = 1', new_source: 'x = 2', cell_id: 'c3', edit_mode: 'replace' }, place('nb.ipynb'), 1)
    expect([cell?.add, cell?.del, cell?.note]).toEqual([1, 1, 'cell c3'])
    const modified = editStep('Edit', { userModified: true, structuredPatch: [{ lines: ['-a', '+b'] }] }, place('x'), 1)
    expect(modified?.isUserModified).toBe(true)
  })
})

describe('turns', () => {
  test('steps gather in the running turn; the turn ends with the hint; a prompt clears it', async () => {
    let state = onTurnStart(initialReplay())
    state = addSteps(state, [step('README.md'), step('src/greet.js')], true)
    state = finishTurn(state, 't1', 'Rename greet', 10, false)
    expect([state.turns.length, state.isHinted, headline(summaryOf(state.turns[0]))]).toEqual([1, true, '2 edits in 2 files'])
    expect(onTurnStart(state).isHinted).toBe(false)
    expect(finishTurn(onTurnStart(state), 't2', '', 11, false).turns).toHaveLength(1) // no edits, no new turn
  })

  test('edits after the turn join it as "after the turn"', async () => {
    let state = finishTurn(addSteps(initialReplay(), [step('a.js')], true), 't1', '', 1, false)
    state = addSteps(state, [step('b.js')], false)
    expect(state.turns[0]?.steps.map(one => one.isAfterTurn)).toEqual([false, true])
  })

  test('a new turn while Replay shows one: it stays, and "New edits ready" shows', async () => {
    let state = finishTurn(addSteps(initialReplay(), [step('a.js'), step('b.js')], true), 't1', '', 1, false)
    state = goTo(state, 1)
    state = finishTurn(addSteps(onTurnStart(state), [step('c.js')], true), 't2', '', 2, true)
    expect([state.turn, state.step, state.hasNew]).toEqual([1, 1, true])
    expect(showTurn(state, 0)).toMatchObject({ turn: 0, step: 0, hasNew: false })
  })

  test('at most 3 turns; the store keeps them under 1 MiB and reads them back', async () => {
    let state = initialReplay()
    for (let turn = 0; turn < 5; turn++) state = finishTurn(addSteps(onTurnStart(state), [step(`f${turn}.js`)], true), `t${turn}`, '', turn, false)
    expect(state.turns.map(turn => turn.id)).toEqual(['t4', 't3', 't2'])
    expect(fromStore(forStore(state)).map(turn => turn.id)).toEqual(['t4', 't3', 't2'])
    const big: ReplayStep = { ...step('big.js'), lines: Array.from({ length: 400 }, () => ({ op: '+' as const, text: 'x'.repeat(500) })) }
    const heavy = { ...state, turns: state.turns.map(turn => ({ ...turn, steps: Array.from({ length: 4 }, () => big) })) }
    expect(new TextEncoder().encode(JSON.stringify(forStore(heavy))).length).toBeLessThan(REPLAY_CAP_BYTES)
    expect(fromStore({ turns: [{ id: 1 }] })).toEqual([])
  })
})

describe('pictures', () => {
  test('timeline parts per step, the edit names its step', async () => {
    const state = finishTurn(addSteps(initialReplay(), [step('README.md'), step('src/cli.js')], true), 't1', '', 1, false)
    expect(timelineSvg(480, state.turns[0]!.steps, 0, '').parts.map(part => part.key)).toEqual(['step:0', 'step:1'])
    const edit = editSvg(480, state, '')
    expect(edit.svg).toContain('EDIT 1 OF 2')
    expect(edit.svg).toContain('welcome')
    expect(headerSvg(480, state, '').svg).toContain('2 edits in 2 files')
  })
})
