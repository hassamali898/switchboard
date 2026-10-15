// The Files tree's state and its rules (screens F2 and F3): what Claude is doing right now, what it
// touched this turn, git's view, and the tree rows. Pure functions over FilesState; register.tsx feeds
// in tool calls, git output and folder listings, and keeps the value in `$.state`.

import type { FileChange, FileNode, FilesActivity, FilesSearch, FilesState, Touch, TouchHow } from '../../../types/index.d.ts'
import { totals, type Status } from './git.ts'
import { basename, dirname, inside, relative } from './paths.ts'

export type { FileChange, FilesState, FileNode, FilesSearch, Touch }

export const MAX_TOUCHED = 40
/** Rows drawn at most; past it the tree says how many more there are. */
export const MAX_ROWS = 300

export function initialFiles(root = ''): FilesState {
  return {
    root, isPinned: false, isGit: false, prefix: '', branch: '', isDetached: false, hasCommits: true,
    nodes: {}, expanded: [], showHidden: true, status: {}, diff: {},
    activity: { kind: 'idle', path: '', at: 0 }, touched: [], commit: null, pushed: '', pr: null, error: '',
    search: { query: '', matches: [], isLoading: false, total: 0 }, showSizes: false, sizes: {}, sessionId: '',
  }
}

/** A new root: everything about the old one goes. */
export function withRoot(state: FilesState, root: string, isPinned: boolean): FilesState {
  return { ...initialFiles(root), isPinned, showHidden: state.showHidden, showSizes: state.showSizes, sessionId: state.sessionId }
}

/** Where a path the tools name sits: relative to the root, or absolute and outside. */
export function place(state: FilesState, absolute: string): { path: string; isOutside: boolean } {
  return inside(state.root, absolute) ? { path: relative(state.root, absolute), isOutside: false } : { path: absolute, isOutside: true }
}

function touch(state: FilesState, absolute: string, how: TouchHow, now: number, agent?: string): FilesState {
  const { path, isOutside } = place(state, absolute)
  const previous = state.touched.find(one => one.path === path)
  // An edit outranks a read: a file Claude edited stays "edited" when it is read again.
  const rank: Record<TouchHow, number> = { searching: 0, read: 1, reading: 1, editing: 3, edited: 3, committed: 4 }
  const keepsPrevious = previous && rank[previous.how] > rank[how] && how !== 'editing'
  const next: Touch = keepsPrevious ? { ...previous, at: now }
    : { ...(previous ?? {}), path, isOutside, how, at: now, ...(agent ? { agent } : {}) }
  // Only one file is "reading" at a time; earlier ones become "read".
  const others = state.touched.filter(one => one.path !== path)
    .map(one => (one.how === 'reading' && how === 'reading' ? { ...one, how: 'read' as const } : one))
  return { ...state, touched: [next, ...others].slice(0, MAX_TOUCHED) }
}

const activity = (kind: FilesActivity['kind'], state: FilesState, absolute: string, now: number): FilesActivity =>
  ({ kind, path: absolute ? place(state, absolute).path : '', at: now })

/** Read, NotebookRead and Bash reads: before the call runs. */
export function onRead(state: FilesState, absolute: string, now: number, agent?: string): FilesState {
  return { ...touch(state, absolute, 'reading', now, agent), activity: activity('reading', state, absolute, now) }
}

/** Grep and Glob: Claude is looking through a folder. */
export function onSearch(state: FilesState, absoluteDir: string, now: number): FilesState {
  return { ...state, activity: activity('searching', state, absoluteDir, now) }
}

/** Edit, Write, NotebookEdit: before the call runs. */
export function onEditStart(state: FilesState, absolute: string, now: number, agent?: string): FilesState {
  return { ...touch(state, absolute, 'editing', now, agent), activity: activity('editing', state, absolute, now) }
}

/** The edit finished. A denied or failed edit takes its card and its "editing" mark back. */
export function onEditDone(state: FilesState, absolute: string, isApplied: boolean, now: number): FilesState {
  const { path } = place(state, absolute)
  if (!isApplied) {
    const touched = state.touched.filter(one => !(one.path === path && one.how === 'editing'))
    return { ...state, touched, activity: state.activity.path === path ? { kind: 'idle', path: '', at: now } : state.activity }
  }
  return { ...state, touched: state.touched.map(one => (one.path === path ? { ...one, how: 'edited' as const, at: now } : one)) }
}

/** Files a shell command changed (Bash `bashEditDiff`, or the `find -newer` mark). */
export function onShellEdits(state: FilesState, absolutes: readonly string[], now: number, agent?: string): FilesState {
  let next = state
  for (const absolute of absolutes) next = touch(next, absolute, 'edited', now, agent)
  return absolutes.length ? { ...next, activity: activity('editing', state, absolutes[0] ?? '', now) } : next
}

/** A new prompt: last turn's marks and card go. */
export function onTurnStart(state: FilesState, now: number): FilesState {
  return { ...state, touched: [], commit: null, pushed: '', pr: null, activity: { kind: 'idle', path: '', at: now } }
}

/** The turn ended: "Claude edited N files" if it edited any; otherwise nothing. */
export function onTurnEnd(state: FilesState, now: number): FilesState {
  const touched = state.touched.map(one => (one.how === 'reading' ? { ...one, how: 'read' as const } : one))
  const edited = touched.filter(one => one.how === 'edited' || one.how === 'committed')
  return { ...state, touched, activity: edited.length ? { kind: 'done', path: '', at: now } : { kind: 'idle', path: '', at: now } }
}

/**
 * A commit is proven (the Bash result's `gitOperation.commit.sha`, or HEAD moved): the files it holds
 * that Claude touched become "committed", with the commit's own line counts.
 */
export function onCommit(state: FilesState, sha: string, files: readonly string[], diff: Record<string, [number, number]>): FilesState {
  const inCommit = new Set(files)
  const touched = state.touched.map(one => {
    if (one.isOutside || !inCommit.has(one.path)) return one
    const [add, del] = diff[one.path] ?? [one.add ?? 0, one.del ?? 0]
    return { ...one, how: 'committed' as const, add, del }
  })
  const sum = totals(diff)
  return { ...state, touched, commit: { sha, files: [...files], add: sum.add, del: sum.del } }
}

/** Git's latest view: status and line counts. Touched files take their counts from it. */
export function withStatus(state: FilesState, status: Status, diff: Record<string, [number, number]>): FilesState {
  const touched = state.touched.map(one => {
    if (one.how === 'committed' || one.isOutside) return one
    const counts = diff[one.path]
    return counts ? { ...one, add: counts[0], del: counts[1] } : one
  })
  return {
    ...state, touched, status: status.files, diff, isGit: true,
    branch: status.branch?.head ?? state.branch, isDetached: status.branch?.isDetached ?? false,
    hasCommits: status.branch?.hasCommits ?? true,
  }
}

/** A folder's children as listed (never `.git`'s insides). */
export function withChildren(state: FilesState, folder: string, children: FileNode[]): FilesState {
  return { ...state, nodes: { ...state.nodes, [folder]: sortNodes(children) } }
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function sortNodes(nodes: FileNode[]): FileNode[] {
  return [...nodes].sort((a, b) => (a.isDir === b.isDir ? collator.compare(a.name, b.name) : a.isDir ? -1 : 1))
}

export function toggleFolder(state: FilesState, folder: string): FilesState {
  const isOpen = state.expanded.includes(folder)
  return { ...state, expanded: isOpen ? state.expanded.filter(one => one !== folder && !inside(folder, one)) : [...state.expanded, folder] }
}

export const collapseAll = (state: FilesState): FilesState => ({ ...state, expanded: [] })

/** Folders to open so that a touched file shows in the tree. */
export function foldersToReveal(state: FilesState, path: string): string[] {
  const out: string[] = []
  for (let dir = dirname(path); dir !== '.' && dir !== '/' && dir !== ''; dir = dirname(dir)) out.unshift(dir)
  return out.filter(dir => !state.expanded.includes(dir))
}

// ---- what the screens show ------------------------------------------------------------------------

export type Tone = 'teal' | 'orange' | 'green' | 'amber' | 'muted'

export type Card = { tone: Tone; icon: 'eye' | 'search' | 'pencil'; eyebrow: string; title: string; sub: string }

/** The RIGHT NOW / DONE card, or null when idle (the branch row shows alone). */
export function cardOf(state: FilesState): Card | null {
  const { activity } = state
  const where = (path: string) => (dirname(path) === '.' ? 'in the project root' : `in ${dirname(path)}`)
  switch (activity.kind) {
    case 'reading':
      return { tone: 'teal', icon: 'eye', eyebrow: 'Right now', title: `Claude is reading ${basename(activity.path)}`, sub: where(activity.path) }
    case 'searching':
      return { tone: 'teal', icon: 'search', eyebrow: 'Right now', title: `Claude is searching ${activity.path ? basename(activity.path) : 'the project'}`,
        sub: activity.path ? where(activity.path) : '' }
    case 'editing':
      return { tone: 'orange', icon: 'pencil', eyebrow: 'Right now', title: `Claude is editing ${basename(activity.path)}`, sub: where(activity.path) }
    case 'done': {
      const edited = state.touched.filter(one => one.how === 'edited' || one.how === 'committed')
      if (!edited.length) return null
      return { tone: 'orange', icon: 'pencil', eyebrow: 'Done',
        title: `Claude edited ${edited.length} ${edited.length === 1 ? 'file' : 'files'}`,
        sub: edited.map(one => one.path).join(' · ') }
    }
    default:
      return null
  }
}

export type BranchLine = { name: string; add: number; del: number; note: string; noteTone: Tone }

/** The branch row: "clean, nothing changed", "+a −d · N changed", "+a −d · committed", or no git. */
export function branchLineOf(state: FilesState): BranchLine | null {
  if (!state.isGit) return null
  const name = state.isDetached ? 'detached HEAD' : state.branch || 'main'
  const changed = Object.keys(state.status).length
  if (state.commit && changed === 0) {
    return { name, add: state.commit.add, del: state.commit.del, note: 'committed', noteTone: 'green' }
  }
  if (changed === 0) return { name, add: 0, del: 0, note: state.hasCommits ? 'clean, nothing changed' : 'no commits yet', noteTone: 'muted' }
  const sum = totals(state.diff)
  return { name, add: sum.add, del: sum.del, note: `${changed} changed`, noteTone: 'amber' }
}

export type TouchedRow = Touch & {
  name: string
  folder: string
  /** What follows the name: its folder, "renamed from <old>", "by agent <type>". */
  detail: string
  pill: string
  tone: Tone
}

const PILL: Record<TouchHow, { text: string; tone: Tone }> = {
  reading: { text: 'Reading', tone: 'teal' }, read: { text: 'Opened', tone: 'muted' }, searching: { text: 'Searched', tone: 'muted' },
  editing: { text: 'Editing', tone: 'orange' }, edited: { text: 'Edited', tone: 'orange' }, committed: { text: 'committed', tone: 'green' },
}

/** "Claude touched": edits first, then reads, newest first within each. */
export function touchedRows(state: FilesState): TouchedRow[] {
  const weight = (how: TouchHow) => (how === 'committed' || how === 'edited' || how === 'editing' ? 0 : 1)
  return [...state.touched]
    .sort((a, b) => weight(a.how) - weight(b.how) || b.at - a.at)
    .map(one => {
      const folder = dirname(one.path) === '.' ? '' : dirname(one.path)
      const change = one.isOutside ? undefined : state.status[one.path]
      const renamed = change?.kind === 'renamed' && change.from ? `renamed from ${basename(change.from)}` : ''
      const detail = [one.isOutside ? '' : folder, renamed, one.agent ? `by agent ${one.agent}` : ''].filter(Boolean).join(' · ')
      return { ...one, name: basename(one.path), folder, detail, pill: PILL[one.how].text, tone: PILL[one.how].tone }
    })
}

export type TreeRow = {
  path: string
  name: string
  depth: number
  isDir: boolean
  isOpen: boolean
  /** Reading now, committed this turn, edited this turn, or changed in git. */
  mark: 'reading' | 'committed' | 'edited' | 'changed' | null
  /** Folders take the tone of what is inside them. */
  tone: Tone | null
  mtimeMs: number
  /** Bytes; -1 for a folder `du` hasn't measured yet. */
  size: number
}

/** The rows the tree shows, open folders walked in order, up to `limit` (MAX_ROWS). */
export function treeRows(state: FilesState, limit = MAX_ROWS): { rows: TreeRow[]; more: number } {
  const marks = new Map<string, TreeRow['mark']>()
  for (const one of state.touched) {
    if (one.isOutside) continue
    const mark = one.how === 'reading' ? 'reading' : one.how === 'committed' ? 'committed'
      : one.how === 'edited' || one.how === 'editing' ? 'edited' : null
    if (mark) marks.set(one.path, mark)
  }
  for (const path of Object.keys(state.status)) if (!marks.has(path)) marks.set(path, 'changed')
  const toneOf = (mark: TreeRow['mark']): Tone | null =>
    mark === 'reading' ? 'teal' : mark === 'committed' ? 'green' : mark === 'edited' ? 'orange' : mark === 'changed' ? 'amber' : null
  // A folder's tone: the strongest mark inside it.
  const strength: Record<string, number> = { reading: 4, edited: 3, committed: 2, changed: 1 }
  const folderTone = new Map<string, Tone>()
  const folderStrength = new Map<string, number>()
  for (const [path, mark] of marks) {
    for (let dir = dirname(path); dir !== '.' && dir !== '/' && dir; dir = dirname(dir)) {
      const level = strength[mark ?? ''] ?? 0
      if ((folderStrength.get(dir) ?? 0) < level) {
        folderStrength.set(dir, level)
        folderTone.set(dir, toneOf(mark) ?? 'muted')
      }
    }
  }
  const open = new Set(state.expanded)
  const rows: TreeRow[] = []
  let more = 0
  const walk = (folder: string, depth: number) => {
    for (const node of state.nodes[folder] ?? []) {
      if (!state.showHidden && node.isHidden) continue
      if (rows.length >= limit) {
        more++
        continue
      }
      const isOpen = node.isDir && open.has(node.path)
      const mark = node.isDir ? null : marks.get(node.path) ?? null
      rows.push({ path: node.path, name: node.name, depth, isDir: node.isDir, isOpen, mark,
        tone: node.isDir ? folderTone.get(node.path) ?? null : toneOf(mark), mtimeMs: node.mtimeMs,
        size: node.isDir ? state.sizes[node.path] ?? -1 : node.size })
      if (isOpen) walk(node.path, depth + 1)
    }
  }
  walk('', 0)
  return { rows, more }
}

/** "15:40" today, "Oct 3" before. */
export function shortTime(ms: number, now: number): string {
  if (!ms) return ''
  const date = new Date(ms)
  const today = new Date(now)
  const pad = (value: number) => String(value).padStart(2, '0')
  if (date.toDateString() === today.toDateString()) return `${pad(date.getHours())}:${pad(date.getMinutes())}`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** The project's name: its folder. */
export const projectName = (state: FilesState) => basename(state.root) || state.root

/** A read that was denied or failed: its mark and card go. */
export function onReadFailed(state: FilesState, absolute: string, now: number): FilesState {
  const { path } = place(state, absolute)
  const touched = state.touched.filter(one => !(one.path === path && one.how === 'reading'))
  return { ...state, touched, activity: state.activity.path === path ? { kind: 'idle', path: '', at: now } : state.activity }
}

/** Shell reads: files Claude read with a command (cat, grep, ...), marked as opened, not "reading". */
export function onShellReads(state: FilesState, absolutes: readonly string[], now: number): FilesState {
  let next = state
  for (const absolute of absolutes) next = touch(next, absolute, 'read', now)
  return next
}

/** Files whose git status appeared or changed between two status reads: what a shell command edited. */
export function changedBetween(before: Record<string, FileChange>, after: Record<string, FileChange>): string[] {
  return Object.keys(after).filter(path => before[path]?.kind !== after[path]?.kind)
}

/** The one line the Switchboard pane shows for Files. */
export function statusLine(state: FilesState): string {
  const edited = state.touched.filter(one => one.how === 'edited' || one.how === 'committed').length
  if (state.activity.kind === 'reading') return 'reading'
  if (state.activity.kind === 'editing') return 'editing'
  if (edited) return `${edited} edited`
  return 'watching'
}


// ---- Show sizes, Find a file, the footer --------------------------------------------------------

/** "812 B", "4.2 KB", "13 MB". */
export function shortSize(bytes: number): string {
  if (bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

/** Folders on screen that Show sizes still has to measure, at most `cap`. */
export function foldersToMeasure(state: FilesState, cap = 60): string[] {
  if (!state.showSizes) return []
  return treeRows(state).rows.filter(row => row.isDir && state.sizes[row.path] === undefined).slice(0, cap).map(row => row.path)
}

/** Parses `du -sk -- a b c` run in the root: sizes in bytes by relative path. */
export function parseDu(stdout: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const line of stdout.split('\n')) {
    const match = line.match(/^(\d+)\t(.+)$/)
    if (match) out[match[2]!.replace(/^\.\//, '')] = Number(match[1]) * 1024
  }
  return out
}

export const MAX_MATCHES = 60

/**
 * The files whose path holds every word of the query, best first: a name that starts with the
 * query, then a name holding it, then the path holding it; shorter paths first among equals.
 */
export function matchFiles(all: readonly string[], query: string, cap = MAX_MATCHES): { matches: string[]; total: number } {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return { matches: [], total: 0 }
  const whole = words.join(' ')
  const scored: [number, string][] = []
  for (const path of all) {
    const lower = path.toLowerCase()
    if (!words.every(word => lower.includes(word))) continue
    const name = basename(lower)
    const score = name.startsWith(whole) ? 0 : name.includes(whole) ? 1 : 2
    scored.push([score, path])
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].length - b[1].length || collator.compare(a[1], b[1]))
  return { matches: scored.slice(0, cap).map(([, path]) => path), total: scored.length }
}

export function withQuery(state: FilesState, query: string): FilesState {
  return { ...state, search: { ...state.search, query, ...(query.trim() ? {} : { matches: [], total: 0, isLoading: false }) } }
}

/** A push or a pull request Claude made this turn (the Bash result's `gitOperation`). */
export function onGitOperation(state: FilesState, operation: { push?: { branch: string }; pr?: { number: number; action: string } }): FilesState {
  return {
    ...state,
    ...(operation.push ? { pushed: operation.push.branch } : {}),
    ...(operation.pr ? { pr: { number: operation.pr.number, action: operation.pr.action } } : {}),
  }
}

const PR_WORDS: Record<string, string> = {
  created: 'created', edited: 'edited', merged: 'merged', commented: 'commented on', closed: 'closed', reopened: 'reopened',
  ready: 'marked ready', draft: 'made a draft', 'auto-merge-enabled': 'set to auto-merge', 'auto-merge-disabled': 'auto-merge off',
}

/** The footer lines, newest kind last: "committed <sha>", "pushed to <branch>", "PR #482 created". */
export function footerOf(state: FilesState): { text: string; code: string }[] {
  const lines: { text: string; code: string }[] = []
  if (state.commit) lines.push({ text: 'committed', code: state.commit.sha.slice(0, 7) })
  if (state.pushed) lines.push({ text: 'pushed to', code: state.pushed })
  if (state.pr) lines.push({ text: `PR #${state.pr.number} ${PR_WORDS[state.pr.action] ?? state.pr.action}`, code: '' })
  return lines
}

/** Folders to skip when looking for files a command changed, or listing files to search. */
export const PRUNE = ['.git', 'node_modules', '.venv', 'venv', '__pycache__', '.next', 'dist', 'build', '.cache', 'target', '.DS_Store']

/** Parses `find ... -print0` output into paths relative to the root (files inside it only). */
export function parseFind(stdout: string, root: string): string[] {
  return stdout.split('\0').filter(path => path && path !== root && inside(root, path)).map(path => relative(root, path))
}
