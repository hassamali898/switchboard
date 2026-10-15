// Files (phase 1): the Bash read parser, git parsers and the tree's state rules. Pure, no engine.

import { describe, expect, test } from 'claude-code/testing'
import { isReadOnly, readTargets } from '../../hooks/features/files/bash.ts'
import { parseBranch, parseNames, parseNumstat, parseStatus, totals } from '../../hooks/features/files/git.ts'
import {
  branchLineOf, cardOf, collapseAll, foldersToReveal, initialFiles, onCommit, onEditDone, onEditStart, onRead, onSearch,
  onShellEdits, onTurnEnd, onTurnStart, toggleFolder, touchedRows, treeRows, withChildren, withStatus, type FileNode,
  footerOf, foldersToMeasure, matchFiles, onGitOperation, parseDu, parseFind, shortSize, withQuery,
} from '../../hooks/features/files/model.ts'
import { dirname, inside, relative, resolve } from '../../hooks/features/files/paths.ts'
import { chunkKeyOf, footerSvg, matchesSvg, treeChunks } from '../../hooks/features/files/pictures.ts'

const ROOT = '/work/weather-app'
const node = (path: string, isDir = false, extra: Partial<FileNode> = {}): FileNode =>
  ({ path, name: path.split('/').pop() ?? path, isDir, isHidden: (path.split('/').pop() ?? '').startsWith('.'), mtimeMs: 0, size: 0, ...extra })

describe('paths', () => {
  test('resolve folds . and .. and ~', async () => {
    expect(resolve('/a/b', '../c/./d')).toBe('/a/c/d')
    expect(resolve('/a/b', '/x/')).toBe('/x')
    expect(resolve('/a', '~/notes', '/home/me')).toBe('/home/me/notes')
    expect(resolve('C:/work', '..\\other')).toBe('C:/other')
  })

  test('inside, relative, dirname, ancestors', async () => {
    expect(inside(ROOT, `${ROOT}/src/a.js`)).toBe(true)
    expect(inside(ROOT, '/work/weather-application/x')).toBe(false)
    expect(relative(ROOT, `${ROOT}/src/a.js`)).toBe('src/a.js')
    expect(dirname('src/api/client.js')).toBe('src/api')
    expect(dirname('client.js')).toBe('.')
  })
})

describe('shell reads', () => {
  test('read-only commands are told from writing ones', async () => {
    expect(isReadOnly('cat src/a.js | head -20')).toBe(true)
    expect(isReadOnly('git status && git log -3')).toBe(true)
    expect(isReadOnly('echo hi > out.txt')).toBe(false)
    expect(isReadOnly("sed -i '' s/a/b/ x.js")).toBe(false)
    expect(isReadOnly('find . -name "*.tmp" -delete')).toBe(false)
    expect(isReadOnly('npm test')).toBe(false)
    expect(isReadOnly('ls 2>/dev/null')).toBe(true)
  })

  test('targets: arguments, cd, patterns skipped, paths printed by searchers', async () => {
    expect(readTargets('cat src/a.js tests/b.js', ROOT, '')).toEqual([`${ROOT}/src/a.js`, `${ROOT}/tests/b.js`])
    expect(readTargets('cd src && head -5 api/client.js', ROOT, '')).toEqual([`${ROOT}/src/api/client.js`])
    expect(readTargets('grep -n fetch src', ROOT, 'src/api/client.js:12:  fetch(url)\nsrc/x.js:3:fetch'))
      .toEqual([`${ROOT}/src`, `${ROOT}/src/api/client.js`, `${ROOT}/src/x.js`])
    expect(readTargets('cat "$FILE" *.js', ROOT, '')).toEqual([])
    expect(readTargets('npm test', ROOT, 'src/a.js')).toEqual([])
  })
})

describe('git parsers', () => {
  test('branch line: ahead and behind, no commits, detached', async () => {
    expect(parseBranch('## main...origin/main [ahead 2, behind 1]')).toMatchObject({ head: 'main', upstream: 'origin/main', ahead: 2, behind: 1 })
    expect(parseBranch('## No commits yet on main')).toMatchObject({ head: 'main', hasCommits: false })
    expect(parseBranch('## HEAD (no branch)')).toMatchObject({ isDetached: true })
  })

  test('status: kinds, renames, untracked folders, paths under the prefix only', async () => {
    const out = ['## main', ' M app/src/a.js', 'A  app/new.js', 'R  app/b.js', 'app/old-b.js', '?? app/tmp/', '?? other/x.js', ' D app/gone.js', 'UU app/c.js', ''].join('\0')
    const status = parseStatus(out, 'app/')
    expect(status.branch?.head).toBe('main')
    expect(status.files).toEqual({
      'src/a.js': { kind: 'modified', isStaged: false },
      'new.js': { kind: 'new', isStaged: true },
      'b.js': { kind: 'renamed', isStaged: true, from: 'old-b.js' },
      'gone.js': { kind: 'deleted', isStaged: false },
      'c.js': { kind: 'conflict', isStaged: true },
    })
    expect(status.untrackedDirs).toEqual(['tmp'])
  })

  test('numstat: counts, binary files, renames', async () => {
    const out = ['3\t1\tsrc/a.js', '-\t-\timg.png', '2\t2\t', 'old.js', 'new.js', ''].join('\0')
    expect(parseNumstat(out)).toEqual({ 'src/a.js': [3, 1], 'img.png': [0, 0], 'new.js': [2, 2] })
    expect(totals({ a: [3, 1], b: [2, 2] })).toEqual({ add: 5, del: 3 })
    expect(parseNames('a\0b/c\0')).toEqual(['a', 'b/c'])
  })
})

describe('Files state', () => {
  const start = () => initialFiles(ROOT)

  test('idle shows no card; reading shows the teal RIGHT NOW card', async () => {
    expect(cardOf(start())).toBeNull()
    const reading = onRead(start(), `${ROOT}/tests/client.test.js`, 1)
    expect(cardOf(reading)).toEqual({ tone: 'teal', icon: 'eye', eyebrow: 'Right now', title: 'Claude is reading client.test.js', sub: 'in tests' })
    expect(touchedRows(reading)[0]).toMatchObject({ name: 'client.test.js', folder: 'tests', pill: 'Reading', tone: 'teal' })
  })

  test('only one file reads at a time; the earlier one becomes Opened', async () => {
    const two = onRead(onRead(start(), `${ROOT}/a.js`, 1), `${ROOT}/b.js`, 2)
    expect(touchedRows(two).map(row => [row.name, row.pill])).toEqual([['b.js', 'Reading'], ['a.js', 'Opened']])
  })

  test('editing, then done: "Claude edited 2 files" with the paths', async () => {
    let state = onEditStart(start(), `${ROOT}/src/api/client.js`, 1)
    expect(cardOf(state)?.title).toBe('Claude is editing client.js')
    state = onEditDone(state, `${ROOT}/src/api/client.js`, true, 2)
    state = onEditDone(onEditStart(state, `${ROOT}/tests/client.test.js`, 3), `${ROOT}/tests/client.test.js`, true, 4)
    state = onTurnEnd(state, 5)
    expect(cardOf(state)).toMatchObject({ eyebrow: 'Done', title: 'Claude edited 2 files', sub: 'tests/client.test.js · src/api/client.js' })
  })

  test('a denied or failed edit takes its mark and card back', async () => {
    const state = onEditDone(onEditStart(start(), `${ROOT}/a.js`, 1), `${ROOT}/a.js`, false, 2)
    expect(state.touched).toEqual([])
    expect(cardOf(state)).toBeNull()
  })

  test('a turn with only reads ends with no card', async () => {
    expect(cardOf(onTurnEnd(onRead(start(), `${ROOT}/a.js`, 1), 2))).toBeNull()
  })

  test('a read never downgrades an edited file', async () => {
    let state = onEditDone(onEditStart(start(), `${ROOT}/a.js`, 1), `${ROOT}/a.js`, true, 2)
    state = onRead(state, `${ROOT}/a.js`, 3)
    expect(touchedRows(state)[0]?.pill).toBe('Edited')
  })

  test('a new prompt clears last turn', async () => {
    const state = onTurnStart(onTurnEnd(onShellEdits(start(), [`${ROOT}/a.js`], 1), 2), 3)
    expect(state.touched).toEqual([])
    expect(cardOf(state)).toBeNull()
  })

  test('files outside the project are listed with their full path, never in the tree', async () => {
    const state = onRead(start(), '/etc/hosts', 1)
    expect(touchedRows(state)[0]).toMatchObject({ path: '/etc/hosts', isOutside: true })
    expect(treeRows(withChildren(state, '', [node('a.js')])).rows.map(row => row.mark)).toEqual([null])
  })

  test('searching shows its folder', async () => {
    expect(cardOf(onSearch(start(), `${ROOT}/src`, 1))?.title).toBe('Claude is searching src')
  })

  test('branch row: clean, changed, committed, not a git folder', async () => {
    expect(branchLineOf(start())).toBeNull()
    const clean = withStatus(start(), { branch: parseBranch('## main'), files: {}, untrackedDirs: [] }, {})
    expect(branchLineOf(clean)).toEqual({ name: 'main', add: 0, del: 0, note: 'clean, nothing changed', noteTone: 'muted' })
    const changed = withStatus(start(), { branch: parseBranch('## main'), files: { 'a.js': { kind: 'modified', isStaged: false } }, untrackedDirs: [] }, { 'a.js': [3, 1] })
    expect(branchLineOf(changed)).toEqual({ name: 'main', add: 3, del: 1, note: '1 changed', noteTone: 'amber' })
    const committed = onCommit(clean, 'a1c9e42', ['a.js'], { 'a.js': [2, 2] })
    expect(branchLineOf(committed)).toEqual({ name: 'main', add: 2, del: 2, note: 'committed', noteTone: 'green' })
  })

  test('a commit marks the touched files in it as committed, with its counts', async () => {
    let state = onShellEdits(start(), [`${ROOT}/src/a.js`, `${ROOT}/b.js`], 1)
    state = onCommit(state, 'abc1234', ['src/a.js'], { 'src/a.js': [1, 1] })
    expect(touchedRows(state).map(row => [row.name, row.pill, row.add, row.del]).sort())
      .toEqual([['a.js', 'committed', 1, 1], ['b.js', 'Edited', undefined, undefined]])
  })

  test('tree rows: folders first, open folders walked, marks and folder tones', async () => {
    let state = withChildren(start(), '', [node('tests', true), node('package.json'), node('src', true), node('.git', true)])
    state = withChildren(state, 'src', [node('src/api', true), node('src/index.js')])
    state = withChildren(state, 'src/api', [node('src/api/client.js')])
    state = toggleFolder(toggleFolder(state, 'src'), 'src/api')
    state = onRead(state, `${ROOT}/src/api/client.js`, 1)
    const { rows } = treeRows(state)
    expect(rows.map(row => `${'  '.repeat(row.depth)}${row.name}`)).toEqual(['.git', 'src', '  api', '    client.js', '  index.js', 'tests', 'package.json'])
    expect(rows.find(row => row.name === 'client.js')).toMatchObject({ mark: 'reading', tone: 'teal' })
    expect(rows.find(row => row.name === 'api')?.tone).toBe('teal')
    expect(treeRows({ ...state, showHidden: false }).rows.some(row => row.name === '.git')).toBe(false)
  })

  test('closing a folder closes the folders inside it; collapse all; reveal', async () => {
    const open = toggleFolder(toggleFolder(start(), 'src'), 'src/api')
    expect(toggleFolder(open, 'src').expanded).toEqual([])
    expect(collapseAll(open).expanded).toEqual([])
    expect(foldersToReveal(toggleFolder(start(), 'src'), 'src/api/client.js')).toEqual(['src/api'])
  })
})

describe('Following edits', () => {
  test('the tree picture holding a file is found by key, 20 rows to a picture', async () => {
    const state = withChildren(initialFiles('/p'), '', Array.from({ length: 30 }, (_, i) => ({
      path: `f${String(i).padStart(2, '0')}.js`, name: `f${String(i).padStart(2, '0')}.js`, isDir: false, isHidden: false, mtimeMs: 0, size: 0 })))
    expect(chunkKeyOf(state, 'f00.js')).toBe('tree:0')
    expect(chunkKeyOf(state, 'f19.js')).toBe('tree:0')
    expect(chunkKeyOf(state, 'f25.js')).toBe('tree:20')
    expect(chunkKeyOf(state, 'missing.js')).toBeUndefined()
  })

  test('a big folder stays within the desktop budget: 120 rows drawn, the rest counted', async () => {
    const state = withChildren(initialFiles('/p'), '', Array.from({ length: 400 }, (_, i) => ({
      path: `file-with-a-longish-name-${i}.ts`, name: `file-with-a-longish-name-${i}.ts`, isDir: false, isHidden: false, mtimeMs: 0, size: 1234 })))
    const tree = treeChunks(560, state, '', 0)
    expect(tree.chunks.reduce((sum, chunk) => sum + chunk.svg.length, 0)).toBeLessThan(110_000)
    expect(tree.more).toBe(280)
  })
})

describe('Find a file', () => {
  const all = ['src/api/client.js', 'src/api/client.test.js', 'README.md', 'docs/api.md', 'src/clientele/x.js']

  test('every word must match; names that start with the query come first', async () => {
    expect(matchFiles(all, 'client').matches).toEqual(['src/api/client.js', 'src/api/client.test.js', 'src/clientele/x.js'])
    expect(matchFiles(all, 'api test').matches).toEqual(['src/api/client.test.js'])
    expect(matchFiles(all, '   ').matches).toEqual([])
  })

  test('at most 60 matches, with the total', async () => {
    const many = Array.from({ length: 100 }, (_, i) => `f${i}.js`)
    const found = matchFiles(many, 'f')
    expect(found.matches.length).toBe(60)
    expect(found.total).toBe(100)
  })

  test('clearing the query clears the matches; the picture has Clear and one part per match', async () => {
    const state = { ...initialFiles(ROOT), search: { query: 'client', matches: ['src/api/client.js'], total: 1, isLoading: false } }
    expect(withQuery(state, '').search).toEqual({ query: '', matches: [], total: 0, isLoading: false })
    const picture = matchesSvg(480, state, '')
    expect(picture.parts.map(part => part.key)).toEqual(['search:clear', 'match:src/api/client.js'])
    expect(picture.svg).toContain('1 MATCH')
  })
})

describe('Show sizes', () => {
  test('sizes read short', async () => {
    expect(shortSize(812)).toBe('812 B')
    expect(shortSize(4300)).toBe('4.2 KB')
    expect(shortSize(13 * 1024 * 1024)).toBe('13 MB')
    expect(shortSize(-1)).toBe('')
  })

  test('du output, and only folders on screen not yet measured', async () => {
    expect(parseDu('8\tsrc\n120\t./docs\n')).toEqual({ src: 8192, docs: 122880 })
    let state = withChildren(initialFiles(ROOT), '', [node('src', true), node('docs', true), node('a.js', false, { size: 10 })])
    expect(foldersToMeasure(state)).toEqual([])
    state = { ...state, showSizes: true, sizes: { docs: 100 } }
    expect(foldersToMeasure(state)).toEqual(['src'])
    expect(treeRows(state).rows.map(row => row.size)).toEqual([100, -1, 10])
  })
})

describe('Footer, renames, agents, shell edits', () => {
  test('commit, push and PR lines; a new prompt clears them', async () => {
    let state = onCommit(initialFiles(ROOT), 'a1c9e42ffff', [], {})
    state = onGitOperation(state, { push: { branch: 'main' }, pr: { number: 482, action: 'created' } })
    expect(footerOf(state)).toEqual([
      { text: 'committed', code: 'a1c9e42' }, { text: 'pushed to', code: 'main' }, { text: 'PR #482 created', code: '' },
    ])
    expect(footerSvg(480, state)?.height).toBe(94)
    const next = onTurnStart(state, 1)
    expect(footerOf(next)).toEqual([])
    expect(footerSvg(480, next)).toBeNull()
  })

  test("a renamed file says what it was; a subagent's file says which agent", async () => {
    let state = onEditStart(initialFiles(ROOT), `${ROOT}/src/new-name.js`, 1, 'Explore')
    state = { ...state, status: { 'src/new-name.js': { kind: 'renamed', isStaged: true, from: 'src/old-name.js' } } }
    expect(touchedRows(state)[0]?.detail).toBe('src · renamed from old-name.js · by agent Explore')
  })

  test('find output becomes paths inside the root', async () => {
    expect(parseFind(`${ROOT}/a.js\0${ROOT}/src/b.js\0/elsewhere/c.js\0`, ROOT)).toEqual(['a.js', 'src/b.js'])
  })

  test('shell edits carry the agent', async () => {
    const state = onShellEdits(initialFiles(ROOT), [`${ROOT}/x.js`], 1, 'general-purpose')
    expect(state.touched[0]).toMatchObject({ path: 'x.js', how: 'edited', agent: 'general-purpose' })
  })
})
