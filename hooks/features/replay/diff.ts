// Replay's diffs: a Myers line diff, word marks inside changed lines, and readers for the patches the
// tools hand back (`structuredPatch`, `bashEditDiff` hunks) and for `git diff` output. Pure.
// The idea of turning each edit into one step comes from replay-theater (anthropics/claude-code-
// playground, Apache-2.0); the diff here is new: Myers with the common ends trimmed, and word marks.

import type { DiffLine } from '../../../types/index.d.ts'

export type { DiffLine }

/** Lines kept per step (the rest are counted in `cut`), and characters per line. */
export const MAX_STORED_LINES = 400
export const MAX_LINE_CHARS = 500

type Op = '=' | '-' | '+'

/** Above this much work the diff gives up and shows everything removed, then everything added. */
const MAX_LINES = 1_200
const MAX_D = 400

/**
 * The shortest edit script from `a` to `b` (Myers 1986), after the common start and end are
 * trimmed. Returns one op per kept, removed or added item, in order.
 */
export function myers<T>(a: readonly T[], b: readonly T[]): Op[] {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const head: Op[] = Array.from({ length: start }, () => '=' as const)
  const tail: Op[] = Array.from({ length: a.length - endA }, () => '=' as const)
  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  return [...head, ...core(midA, midB), ...tail]
}

function core<T>(a: readonly T[], b: readonly T[]): Op[] {
  const n = a.length
  const m = b.length
  if (n === 0) return Array.from({ length: m }, () => '+' as const)
  if (m === 0) return Array.from({ length: n }, () => '-' as const)
  const everything = (): Op[] => [...Array.from({ length: n }, () => '-' as const), ...Array.from({ length: m }, () => '+' as const)]
  if (n + m > MAX_LINES) return everything()
  const max = n + m
  const offset = max + 1
  const v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  for (let d = 0; d <= max; d++) {
    if (d > MAX_D) return everything()
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[offset + k] = x
      if (x >= n && y >= m) return backtrack(trace, n, m, offset)
    }
  }
  return everything()
}

function backtrack(trace: Int32Array[], n: number, m: number, offset: number): Op[] {
  const ops: Op[] = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d]!
    const k = x - y
    const prevK = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? k + 1 : k - 1
    const prevX = v[offset + prevK]!
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      ops.push('=')
      x--
      y--
    }
    if (d > 0) ops.push(x === prevX ? '+' : '-')
    x = prevX
    y = prevY
  }
  return ops.reverse()
}

export function splitLines(text: string | null | undefined): string[] {
  if (!text) return []
  const lines = text.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** A line diff of two texts, every line kept (trim it with `trimContext`). */
export function diffTexts(before: string | null | undefined, after: string | null | undefined): DiffLine[] {
  const a = splitLines(before)
  const b = splitLines(after)
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  for (const op of myers(a, b)) {
    if (op === '=') {
      out.push({ op: ' ', text: a[i++]! })
      j++
    } else if (op === '-') out.push({ op: '-', text: a[i++]! })
    else out.push({ op: '+', text: b[j++]! })
  }
  return out
}

/** Keeps the changed lines and `context` lines around each; the gaps become one `~` line. */
export function trimContext(lines: readonly DiffLine[], context = 1): DiffLine[] {
  const isChange = (line: DiffLine | undefined) => !!line && (line.op === '-' || line.op === '+')
  if (!lines.some(line => isChange(line))) return lines.filter(line => line.op !== '~').slice(0, 3)
  const keep = lines.map((line, index) => {
    if (line.op === '~') return false
    for (let near = index - context; near <= index + context; near++) if (isChange(lines[near])) return true
    return false
  })
  const out: DiffLine[] = []
  let skipped = false
  lines.forEach((line, index) => {
    if (!keep[index]) {
      skipped = true
      return
    }
    if (skipped && out.length) out.push({ op: '~', text: '' })
    out.push(line)
    skipped = false
  })
  return out
}

/** A tool's `structuredPatch` (or `bashEditDiff` hunks) as diff lines, `~` between hunks. */
export function hunkLines(hunks: readonly { lines: readonly string[] }[]): DiffLine[] {
  const out: DiffLine[] = []
  hunks.forEach((hunk, index) => {
    if (index > 0) out.push({ op: '~', text: '' })
    for (const raw of hunk.lines) {
      const first = raw[0]
      if (first === '\\') continue // "\ No newline at end of file"
      out.push({ op: first === '-' ? '-' : first === '+' ? '+' : ' ', text: raw.slice(1) })
    }
  })
  return out
}

export function counts(lines: readonly DiffLine[]): { add: number; del: number } {
  let add = 0
  let del = 0
  for (const line of lines) {
    if (line.op === '+') add++
    else if (line.op === '-') del++
  }
  return { add, del }
}

/** Lines cut to what is stored: `MAX_STORED_LINES`, each at most `MAX_LINE_CHARS`. */
export function capLines(lines: readonly DiffLine[]): { lines: DiffLine[]; cut: number } {
  const kept = lines.slice(0, MAX_STORED_LINES).map(line =>
    (line.text.length > MAX_LINE_CHARS ? { ...line, text: `${line.text.slice(0, MAX_LINE_CHARS)}…` } : line))
  return { lines: kept, cut: Math.max(0, lines.length - MAX_STORED_LINES) }
}

// ---- git diff ----------------------------------------------------------------------------------

export type FileDiff = { path: string; from?: string; lines: DiffLine[]; kind: 'edit' | 'created' | 'deleted' | 'binary' }

const unquote = (path: string) => (path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1).replace(/\\(.)/g, '$1') : path)

/** Parses `git diff --relative --no-color` output into one entry per file. */
export function parseGitDiff(stdout: string): FileDiff[] {
  const files: FileDiff[] = []
  let current: FileDiff | null = null
  let isInHunk = false
  for (const raw of stdout.split('\n')) {
    const header = raw.match(/^diff --git a\/(.+?) b\/(.+)$/)
    if (header) {
      current = { path: unquote(header[2]!), lines: [], kind: 'edit' }
      if (header[1] !== header[2]) current.from = unquote(header[1]!)
      files.push(current)
      isInHunk = false
      continue
    }
    if (!current) continue
    if (raw.startsWith('new file mode')) current.kind = 'created'
    else if (raw.startsWith('deleted file mode')) current.kind = 'deleted'
    else if (raw.startsWith('Binary files ') || raw.startsWith('GIT binary patch')) current.kind = 'binary'
    else if (raw.startsWith('@@')) {
      if (isInHunk) current.lines.push({ op: '~', text: '' })
      isInHunk = true
    } else if (isInHunk && raw.length) {
      const first = raw[0]
      if (first === '\\') continue
      if (first === '+' || first === '-' || first === ' ') current.lines.push({ op: first, text: raw.slice(1) })
    }
  }
  return files
}

// ---- word marks --------------------------------------------------------------------------------

export type Segment = { text: string; isChanged: boolean }

/** A diff line as drawn: changed words marked inside a removed or added line paired with another. */
export type WordLine = DiffLine & { segments?: Segment[] }

const tokens = (line: string) => line.match(/\w+|\s+|[^\w\s]/g) ?? []

/** Below this share of unchanged text, a pair shows as whole lines. */
const MIN_OVERLAP = 0.4

function wordPair(before: string, after: string): { old: Segment[]; next: Segment[] } | null {
  const a = tokens(before)
  const b = tokens(after)
  if (a.length + b.length > 600) return null
  const ops = myers(a, b)
  const old: Segment[] = []
  const next: Segment[] = []
  const push = (into: Segment[], text: string, isChanged: boolean) => {
    const last = into[into.length - 1]
    if (last && last.isChanged === isChanged) last.text += text
    else into.push({ text, isChanged })
  }
  let i = 0
  let j = 0
  let same = 0
  for (const op of ops) {
    if (op === '=') {
      same += a[i]!.length
      push(old, a[i++]!, false)
      push(next, b[j++]!, false)
    } else if (op === '-') push(old, a[i++]!, true)
    else push(next, b[j++]!, true)
  }
  const total = before.length + after.length
  if (total === 0 || (2 * same) / total < MIN_OVERLAP) return null
  return { old, next }
}

/**
 * Pairs each run of removed lines with the added lines right after it, one to one, and marks the
 * words that changed. Lines without a partner, or too different, stay whole.
 */
export function withWords(lines: readonly DiffLine[]): WordLine[] {
  const out: WordLine[] = lines.map(line => ({ ...line }))
  let index = 0
  while (index < out.length) {
    if (out[index]!.op !== '-') {
      index++
      continue
    }
    const delStart = index
    while (index < out.length && out[index]!.op === '-') index++
    const addStart = index
    while (index < out.length && out[index]!.op === '+') index++
    const pairs = Math.min(addStart - delStart, index - addStart)
    for (let k = 0; k < pairs; k++) {
      const old = out[delStart + k]!
      const next = out[addStart + k]!
      const marked = wordPair(old.text, next.text)
      if (marked) {
        old.segments = marked.old
        next.segments = marked.next
      }
    }
  }
  return out
}
