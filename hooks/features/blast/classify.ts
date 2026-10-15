// Blast Radius: which shell commands are risky enough to hold. Pure.
// Ported from blast-radius (anthropics/claude-code-playground, Apache-2.0, Copyright 2026 Anthropic
// PBC): the segment walk, cd/pushd tracking, sudo and prefix stripping, and the rm, git and
// migration rules. Added: `find -delete` / `-exec rm`, `xargs rm`, `bash -c "<inner>"` (classified
// again), `timeout N`, `doas`, and targets that use a variable.

export type RiskKind = 'rm' | 'find-delete' | 'xargs-rm' | 'git-reset' | 'git-clean' | 'git-push-force' | 'git-checkout' | 'migrate'

export type Risk = {
  kind: RiskKind
  /** The risky part of the command as typed ("rm -rf build"). */
  label: string
  /** Where it runs, relative to the session folder (a `cd` before it), or null for the session folder. */
  dir: string | null
  /** rm: its paths. find: its starting paths. */
  targets: string[]
  /** git: the words after the subcommand. find: the whole expression after the paths. */
  args: string[]
  /** migrate: which tool. */
  tool: string
  /** A target is a variable or a substitution: it can't be measured, but it is still held. */
  usesVariable: boolean
}

const SUDO_VALUE_OPTIONS = new Set(['-u', '-g', '-C', '-D', '-h', '-p', '-r', '-t', '-T', '-U'])
const DOAS_VALUE_OPTIONS = new Set(['-u', '-C'])
const TIMEOUT_VALUE_OPTIONS = new Set(['-s', '-k', '--signal', '--kill-after'])
const READ_ONLY = new Set(['ls', 'cat', 'echo', 'printf', 'grep', 'rg', 'find', 'less', 'head', 'tail', 'cd', 'git'])
const PREFIXES = new Set(['command', 'exec', 'env', 'nohup', 'time', 'then', 'do', 'else', '!'])
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash'])

const isVariable = (word: string) => /\$|`/.test(word)

/** A segment that only sets variables (`A=1 B="x y"`), as name and value pairs; null otherwise. */
function assignments(segment: string): [string, string][] | null {
  const words = tokenize(segment.trim().replace(/^export\s+/, ''))
  if (!words.length || !words.every(word => /^[A-Za-z_][A-Za-z0-9_]*=/.test(word))) return null
  return words.map(word => {
    const at = word.indexOf('=')
    return [word.slice(0, at), word.slice(at + 1)]
  })
}

/** `$NAME` and `${NAME}` replaced with values set earlier on the line; a value that itself uses `$` or a backtick stays as it is. */
function withVars(segment: string, vars: ReadonlyMap<string, string>): string {
  if (!vars.size) return segment
  return segment.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (whole, braced: string | undefined, bare: string | undefined) => {
    const value = vars.get(braced ?? bare ?? '')
    return value !== undefined && !isVariable(value) ? value : whole
  })
}
const cut = (text: string) => (text.length > 80 ? `${text.slice(0, 79)}…` : text)

/** Splits one segment into words, honouring quotes. Good enough to read flags and paths. */
export function tokenize(text: string): string[] {
  const words: string[] = []
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) words.push(match[1] ?? match[2] ?? match[3] ?? '')
  return words
}

function joinDir(dir: string | null, arg: string | undefined): string {
  if (arg === undefined || arg === '~' || arg.startsWith('/') || arg.startsWith('~/')) return arg ?? '~'
  return dir ? `${dir}/${arg}` : arg
}

/**
 * Splits a command line into segments at `&&`, `||`, `;`, `|` and newlines, outside quotes (so a
 * `bash -c "a && b"` stays one segment and is classified again inside).
 */
export function segments(command: string): string[] {
  const out: string[] = []
  let current = ''
  let quote = ''
  for (let i = 0; i < command.length; i++) {
    const char = command[i]!
    if (quote) {
      current += char
      if (char === '\\' && quote === '"' && i + 1 < command.length) current += command[++i]
      else if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }
    const two = command.slice(i, i + 2)
    if (two === '&&' || two === '||') {
      out.push(current)
      current = ''
      i++
      continue
    }
    if (char === ';' || char === '|' || char === '\n') {
      out.push(current)
      current = ''
      continue
    }
    current += char
  }
  out.push(current)
  return out.filter(segment => segment.trim())
}

/** The first risky segment of a shell command, or null. */
export function classify(command: string, depth = 0): Risk | null {
  if (depth > 3) return null
  let dir: string | null = null
  const scopes: (string | null)[] = []
  const pushed: (string | null)[] = []
  // `S=/tmp/x; rm -rf $S/out`: a variable set earlier on the line is read in, so it can be measured.
  const vars = new Map<string, string>()
  for (const original of segments(command)) {
    const raw = withVars(original, vars)
    const assigned = assignments(raw)
    if (assigned) {
      for (const [name, value] of assigned) vars.set(name, value)
      continue
    }
    const opens = raw.match(/^\s*\(+/)?.[0].trim().length ?? 0
    const tail = raw.replace(/(?:\s*(?:\d*>>?|&>>?|<)\s*\S+|\s*&)+\s*$/, '')
    const closes = tail.match(/\)+\s*$/)?.[0].trim().length ?? 0
    for (let k = 0; k < opens; k++) scopes.push(dir)
    const found = classifySegment(raw, dir, pushed, depth)
    if (found && 'kind' in found) return found
    if (found) dir = found.cd
    for (let k = 0; k < closes && scopes.length; k++) dir = scopes.pop() ?? null
  }
  return null
}

/** Drops what can stand before the real command without changing it: VAR=x, sudo, doas, timeout, nice ... */
function stripPrefixes(words: string[]): string[] {
  const out = [...words]
  for (let guard = 0; guard < 8; guard++) {
    const before = out.length
    while (out.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(out[0]!)) out.shift()
    if (out[0] === 'sudo' || out[0] === 'doas') {
      const values = out[0] === 'sudo' ? SUDO_VALUE_OPTIONS : DOAS_VALUE_OPTIONS
      out.shift()
      while (out.length && out[0]!.startsWith('-')) {
        const option = out.shift()!
        if (values.has(option)) out.shift()
      }
    }
    while (out.length && PREFIXES.has(out[0]!)) out.shift()
    if (out[0] === 'nice') {
      out.shift()
      const option: string | undefined = out[0]
      if (option === '-n') out.splice(0, 2)
      else if (/^-\d+$/.test(option ?? '')) out.shift()
    }
    if (out[0] === 'timeout') {
      out.shift()
      while (out.length && out[0]!.startsWith('-')) {
        const option = out.shift()!
        if (TIMEOUT_VALUE_OPTIONS.has(option)) out.shift()
      }
      out.shift() // the duration
    }
    if (out.length === before) break
  }
  return out
}

function classifySegment(segment: string, dir: string | null, pushed: (string | null)[], depth: number): Risk | { cd: string | null } | null {
  const text = segment.trim().replace(/^[({]+\s*/, '').replace(/\s*[)}]+$/, '')
  const words = stripPrefixes(tokenize(text))
  const [first, ...args] = words
  if (first === undefined) return null
  const cmd = first.replace(/^\\/, '').replace(/^.*\//, '')
  const risk = (kind: RiskKind, extra: Partial<Risk> = {}): Risk =>
    ({ kind, label: cut(text), dir, targets: [], args: [], tool: '', usesVariable: false, ...extra })

  if (cmd === 'cd') return { cd: args[0] === '-' ? '-' : joinDir(dir, args[0]) }
  if (cmd === 'pushd') {
    pushed.push(dir)
    return { cd: joinDir(dir, args[0]) }
  }
  if (cmd === 'popd') return { cd: pushed.length ? pushed.pop() ?? null : '-' }

  // bash -c "<inner>": the inner command is classified on its own.
  if (SHELLS.has(cmd)) {
    const at = args.findIndex(arg => arg === '-c' || /^-[a-z]*c$/.test(arg))
    const inner = at >= 0 ? args[at + 1] : undefined
    if (inner) {
      const found = classify(inner, depth + 1)
      return found ? { ...found, dir: found.dir ?? dir } : null
    }
    return null
  }

  if (cmd === 'rm') {
    const flags = args.filter(arg => arg.startsWith('-') && arg !== '-')
    const isRecursive = flags.some(flag => flag === '--recursive' || (/^-[^-]/.test(flag) && /[rR]/.test(flag)))
    const isForce = flags.some(flag => flag === '--force' || (/^-[^-]/.test(flag) && flag.includes('f')))
    if (isRecursive || isForce) {
      const targets = args.filter(arg => !arg.startsWith('-') || arg === '-')
      return risk('rm', { targets, usesVariable: targets.some(isVariable) })
    }
  }

  if (cmd === 'find') {
    const expressionAt = args.findIndex(arg => arg.startsWith('-') || arg === '(' || arg === '!' || arg === '\\(')
    const targets = expressionAt < 0 ? args : args.slice(0, expressionAt)
    const expression = expressionAt < 0 ? [] : args.slice(expressionAt)
    const deletes = expression.includes('-delete')
    const execAt = expression.findIndex(arg => arg === '-exec' || arg === '-execdir' || arg === '-ok')
    const execsRm = execAt >= 0 && /(^|\/)rm$/.test(expression[execAt + 1] ?? '')
    if (deletes || execsRm) {
      return risk('find-delete', { targets: targets.length ? targets : ['.'], args: expression, usesVariable: args.some(isVariable) })
    }
  }

  if (cmd === 'xargs') {
    // xargs' own options come first; the command it runs follows.
    let at = 0
    while (at < args.length && args[at]!.startsWith('-')) at += /^-[IEdLnPs]$/.test(args[at]!) ? 2 : 1
    const runs = stripPrefixes(args.slice(at))
    if ((runs[0] ?? '').replace(/^.*\//, '') === 'rm') return risk('xargs-rm', { usesVariable: true })
  }

  if (cmd === 'git') {
    let gitDir = dir
    let i = 0
    while (i < args.length && args[i]!.startsWith('-')) {
      if (args[i] === '-C' && i + 1 < args.length) {
        gitDir = joinDir(gitDir, args[i + 1])
        i += 2
      } else if (args[i] === '-c' && i + 1 < args.length) i += 2
      else i += 1
    }
    const sub = args[i]
    const rest = args.slice(i + 1)
    const git = (kind: RiskKind) => risk(kind, { args: rest, dir: gitDir })
    if (sub === 'reset' && rest.includes('--hard')) return git('git-reset')
    if (sub === 'clean' && !rest.some(arg => arg === '-n' || arg === '--dry-run')) return git('git-clean')
    if (sub === 'push' && rest.some(arg => arg === '--force' || arg === '-f' || arg.startsWith('--force-with-lease') || /^\+/.test(arg))) {
      return git('git-push-force')
    }
    const isStagedOnly = sub === 'restore' && rest.includes('--staged') && !rest.includes('--worktree') && !rest.includes('-W')
    if ((sub === 'checkout' || sub === 'restore') && rest.includes('.') && !isStagedOnly) return git('git-checkout')
  }

  const joined = words.join(' ')
  if (/\balembic\s+upgrade\b/.test(joined)) return risk('migrate', { tool: 'alembic' })
  if (/\bdb:migrate(?!:status\b)/.test(joined)) return risk('migrate', { tool: 'rails' })
  if (/\bprisma\s+migrate\s+(deploy|dev|reset)\b/.test(joined)) return risk('migrate', { tool: 'prisma' })
  if (/\bmanage\.py\s+migrate\b/.test(joined)) return risk('migrate', { tool: 'django' })
  if (!READ_ONLY.has(cmd) && args.includes('migrate')) return risk('migrate', { tool: 'unknown' })
  return null
}
