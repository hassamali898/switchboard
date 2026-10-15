// Blast Radius: what a held command would change, as the report the pane draws (screen F5). The
// shell scripts take every path as an argument, never as source; register.tsx runs them with
// `$.process.run` (time there is free under the hook budget) and hands the output here. Pure.
// The rm, git and migration measures follow blast-radius (Apache-2.0); per-folder sizes, the largest
// files, the tracked check and find's dry run are new.

import type { BlastReport, BlastRow } from '../../../types/index.d.ts'
import { basename, dirname } from '../files/paths.ts'
import type { Risk } from './classify.ts'

export type { BlastReport, BlastRow }

/** Rows the card shows before "Show more". */
export const SHOWN_ROWS = 8

/**
 * Expands the paths (globs by compgen, no command substitution), then prints:
 * `T files bytes found links`, `D count bytes folder` per folder, `F bytes path` for the 50 largest
 * files, and `G n` (paths git tracks; -1 outside git). Written with `@{` for bash's `${`, which a
 * template literal would read as its own.
 */
export const RM_SCRIPT = String.raw`
shopt -s nullglob dotglob
paths=()
for p in "$@"; do
  case "$p" in "~"|"~/"*) p="$HOME@{p#\~}";; esac
  if [[ "$p" == *[*?[]* ]]; then
    while IFS= read -r m; do paths+=("$m"); done < <(compgen -G "$p")
  elif [[ -e "$p" || -L "$p" ]]; then
    paths+=("$p")
  fi
done
if (( @{#paths[@]} == 0 )); then printf 'T\t0\t0\t0\t0\n'; exit 0; fi
for i in "@{!paths[@]}"; do case "@{paths[$i]}" in /*) ;; *) paths[$i]="./@{paths[$i]}";; esac; done
tmp=$(mktemp "@{TMPDIR:-/tmp}/sb-blast.XXXXXX") || exit 1
trap 'rm -f "$tmp"' EXIT
links=$(find "@{paths[@]}" -type l 2>/dev/null | wc -l | tr -d ' ')
find "@{paths[@]}" -type f -exec wc -c {} + 2>/dev/null | awk -v out="$tmp" -v found="@{#paths[@]}" -v links="$links" '
{ n = $1; p = $0; sub(/^[ \t]*[0-9]+[ \t]/, "", p); if (p == "total") next
  files++; bytes += n; d = p; if (!sub(/\/[^\/]*$/, "", d)) d = "."; dc[d]++; db[d] += n
  printf "F\t%.0f\t%s\n", n, p > out }
END { printf "T\t%.0f\t%.0f\t%d\t%d\n", files, bytes, found, links; for (d in dc) printf "D\t%.0f\t%.0f\t%s\n", dc[d], db[d], d }'
sort -t "$(printf '\t')" -k2,2nr "$tmp" | head -n 50
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  printf 'G\t%s\n' "$(git ls-files -- "@{paths[@]}" 2>/dev/null | wc -l | tr -d ' ')"
else
  printf 'G\t-1\n'
fi
`.replaceAll('@{', '${')

export type RmMeasure = {
  files: number
  bytes: number
  /** Paths that exist after expansion. */
  found: number
  links: number
  folders: { path: string; count: number; bytes: number }[]
  largest: { path: string; bytes: number }[]
  /** Files git tracks among them; -1 outside git. */
  tracked: number
}

const clean = (path: string) => path.replace(/^\.\//, '')

export function parseRm(stdout: string): RmMeasure {
  const out: RmMeasure = { files: 0, bytes: 0, found: 0, links: 0, folders: [], largest: [], tracked: -1 }
  for (const line of stdout.split('\n')) {
    const [tag, a, b, c, d] = line.split('\t')
    if (tag === 'T') Object.assign(out, { files: Number(a), bytes: Number(b), found: Number(c), links: Number(d ?? 0) })
    else if (tag === 'D' && c !== undefined) out.folders.push({ count: Number(a), bytes: Number(b), path: clean(line.split('\t').slice(3).join('\t')) })
    else if (tag === 'F' && b !== undefined) out.largest.push({ bytes: Number(a), path: clean(line.split('\t').slice(2).join('\t')) })
    else if (tag === 'G') out.tracked = Number(a)
  }
  out.folders.sort((x, y) => y.bytes - x.bytes)
  return out
}

/** "812 B", "4.2 KB", "286 KB". */
export function size(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${Math.max(0, Math.round(bytes || 0))} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

type Base = Pick<BlastReport, 'command' | 'where'>

function report(base: Base, fields: Partial<BlastReport>): BlastReport {
  return { ...base, verb: '', amount: '', warn: '', rows: [], more: 0, moreBytes: -1, note: '', action: 'Run it', isEmpty: false, ...fields }
}

/** rm and find -delete: folders by size with their largest files under each; bars against the total. */
export function rmReport(base: Base, measure: RmMeasure, isPartial = false): BlastReport {
  if (!measure.found) {
    return report(base, { verb: 'deletes', amount: 'nothing', note: 'None of its paths exist.', isEmpty: true })
  }
  const total = Math.max(1, measure.bytes)
  const rows: BlastRow[] = []
  const listed = new Set<string>()
  for (const folder of measure.folders.slice(0, 20)) {
    const name = folder.path === '.' ? './' : `${folder.path}/`
    rows.push({ kind: 'folder', name, path: folder.path, isIndented: false, count: plural(folder.count, 'file'), size: size(folder.bytes),
      bar: folder.bytes / total })
    for (const file of measure.largest.filter(one => dirname(one.path) === folder.path || (folder.path === '.' && !one.path.includes('/')))) {
      listed.add(file.path)
      rows.push({ kind: 'file', name: basename(file.path), path: file.path, isIndented: true, count: '', size: size(file.bytes), bar: file.bytes / total })
    }
  }
  const files = measure.files + measure.links
  const amount = files ? `${isPartial ? 'at least ' : ''}${plural(files, 'file')} · ${size(measure.bytes)}` : `${plural(measure.found, 'empty folder')}`
  const warn = measure.tracked === 0 || measure.tracked === -1
    ? `None of these are tracked by git, so they can't be restored.`
    : measure.tracked < files ? `Only ${measure.tracked} of these are tracked by git; the rest can't be restored.` : ''
  const shownBytes = measure.largest.filter(one => listed.has(one.path)).reduce((sum, one) => sum + one.bytes, 0)
  return report(base, {
    verb: 'will delete', amount, warn, rows, more: Math.max(0, files - listed.size), moreBytes: Math.max(0, measure.bytes - shownBytes),
    action: files ? `Delete ${plural(files, 'file')}` : 'Delete', note: isPartial ? 'Measuring took too long; these are the files found so far.' : '',
  })
}

/** What can't be measured is still held, and says why. */
export function unmeasuredReport(base: Base, why: string): BlastReport {
  return report(base, { verb: 'will run', amount: 'unmeasured', note: why, action: 'Run it anyway' })
}

/** `find ... -delete` or `-exec rm`: the same find with `-print` in their place, to list what it would remove. */
/**
 * The topmost of the paths a find lists (a folder takes what is under it), at most `cap`, and whether
 * more were cut. Linear: each path checks its own parents, so 100,000 paths take milliseconds.
 */
export function topmost(paths: readonly string[], cap = 2_000): { top: string[]; isPartial: boolean } {
  const listed = new Set(paths.map(path => path.replace(/\/+$/, '')).filter(Boolean))
  // Kept when no folder above it is listed too (find -delete lists children before their folder).
  const top = [...listed].filter(path => {
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) if (listed.has(parts.slice(0, i).join('/'))) return false
    return true
  })
  return { top: top.slice(0, cap), isPartial: top.length > cap }
}

export function findDryRun(expression: readonly string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < expression.length; i++) {
    const word = expression[i]!
    if (word === '-delete') out.push('-print')
    else if (word === '-exec' || word === '-execdir' || word === '-ok' || word === '-okdir') {
      while (i < expression.length && !/^(\\?;|\+)$/.test(expression[i]!)) i++
      out.push('-print')
    } else out.push(word)
  }
  return out
}

/** Numstat rows (`git diff --numstat --relative`): dirty files with their line counts. */
export function dirtyReport(base: Base, numstat: string, isReset: boolean): BlastReport {
  const rows: BlastRow[] = []
  let add = 0
  let del = 0
  for (const line of numstat.split('\n')) {
    const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/)
    if (!match) continue
    const a = match[1] === '-' ? 0 : Number(match[1])
    const d = match[2] === '-' ? 0 : Number(match[2])
    add += a
    del += d
    rows.push({ kind: 'file', name: basename(match[3]!), path: match[3]!, isIndented: false,
      count: match[1] === '-' ? 'binary' : `+${a} −${d}`, size: dirname(match[3]!) === '.' ? '' : dirname(match[3]!), bar: -1 })
  }
  if (!rows.length) return report(base, { verb: 'discards', amount: 'nothing', note: 'There are no uncommitted changes.', isEmpty: true })
  return report(base, {
    verb: 'will discard', amount: `changes in ${plural(rows.length, 'file')} · +${add} −${del}`, rows,
    warn: isReset ? 'Staged and unstaged changes go, and uncommitted work can\'t be restored.' : 'Unstaged changes go, and they can\'t be restored.',
    action: 'Discard changes',
  })
}

/** `git clean -n` output: what it would remove. */
export function cleanReport(base: Base, dryRun: string): BlastReport {
  const gone = dryRun.split('\n').filter(line => line.startsWith('Would remove ')).map(line => line.slice('Would remove '.length))
  if (!gone.length) return report(base, { verb: 'removes', amount: 'nothing', note: 'No untracked files match.', isEmpty: true })
  return report(base, {
    verb: 'will remove', amount: `${plural(gone.length, 'untracked path')}`, warn: 'Untracked files aren\'t in git, so they can\'t be restored.',
    rows: gone.map(path => ({ kind: path.endsWith('/') ? 'folder' : 'file', name: path, path: path.replace(/\/$/, ''), isIndented: false,
      count: '', size: '', bar: -1 })),
    action: `Remove ${plural(gone.length, 'path')}`, note: 'From git clean -n.',
  })
}

/** Where a force push lands, from its arguments: remote, the ref pushed, the branch it overwrites. */
export function pushTarget(args: readonly string[]): { remote: string; source: string; branch: string } {
  const positional = args.filter(arg => !arg.startsWith('-'))
  const remote = positional[0] ?? 'origin'
  const spec = (positional[1] ?? '').replace(/^\+/, '')
  const [source, branch] = spec.includes(':') ? spec.split(':') as [string, string] : [spec, spec]
  return { remote, source: source || 'HEAD', branch: (branch ?? '').replace(/^refs\/heads\//, '') }
}

/** `git log --oneline <source>..<remote>/<branch>`: the remote commits the push would drop. */
export function pushReport(base: Base, ref: string, log: string | null): BlastReport {
  if (log === null) {
    return report(base, { verb: 'will overwrite', amount: ref, action: 'Force push',
      note: `There's no local copy of ${ref}, so the commits it would drop can't be listed. Run git fetch first.` })
  }
  const dropped = log.split('\n').filter(Boolean)
  if (!dropped.length) return report(base, { verb: 'drops', amount: `no commits on ${ref}`, isEmpty: true })
  return report(base, {
    verb: 'will drop', amount: `${plural(dropped.length, 'commit')} on ${ref}`,
    warn: 'Anyone who has these commits will have to recover them by hand.',
    rows: dropped.map(line => ({ kind: 'commit', name: line, path: line.slice(0, 12), isIndented: false, count: '', size: '', bar: -1 })),
    action: 'Force push', note: `As of the last fetch.`,
  })
}

export const MIGRATION_LISTERS: Record<string, { argv: string[]; isPending: (line: string) => boolean; strip: (line: string) => string }> = {
  django: { argv: ['python3', 'manage.py', 'showmigrations', '--plan'], isPending: line => line.startsWith('[ ]'), strip: line => line.slice(4) },
  alembic: { argv: ['alembic', 'history', '-r', 'current:head'], isPending: line => line.includes('->'), strip: line => line },
  rails: { argv: ['bin/rails', 'db:migrate:status'], isPending: line => /^\s*down\b/.test(line), strip: line => line.trim() },
  prisma: { argv: ['npx', '--no-install', 'prisma', 'migrate', 'status'], isPending: line => /^\s{2}\S/.test(line), strip: line => line.trim() },
}

export function migrateReport(base: Base, tool: string, listed: string | null): BlastReport {
  const lister = MIGRATION_LISTERS[tool]
  if (!lister || listed === null) {
    return report(base, { verb: 'will run', amount: 'migrations', action: 'Run migrations',
      note: lister ? `Couldn't list pending migrations (${lister.argv.join(' ')} failed).` : 'Pending migrations can\'t be listed for this tool.' })
  }
  const pending = listed.split('\n').filter(lister.isPending).map(lister.strip)
  if (!pending.length) return report(base, { verb: 'applies', amount: 'nothing pending', isEmpty: true })
  return report(base, {
    verb: 'will apply', amount: plural(pending.length, 'migration'),
    rows: pending.map(name => ({ kind: 'migration', name, path: name, isIndented: false, count: '', size: '', bar: -1 })),
    action: 'Run migrations', note: `From ${lister.argv.join(' ')}.`,
  })
}

/** The report for a risk that can't be measured at all. */
export function cantMeasure(risk: Risk, base: Base): BlastReport | null {
  if (risk.kind === 'xargs-rm') return unmeasuredReport(base, 'Its paths come from another command, so what it deletes can\'t be measured.')
  if (risk.usesVariable) return unmeasuredReport(base, 'It uses a variable, so what it changes can\'t be measured.')
  return null
}
