// What a shell command reads, for the Files tree. The Bash tool's result has no list of files read
// (checked on 2.1.295), so the command itself is parsed.
// Ported from data-goblin/claude-code-filetree (hooks/git.ts: segments, stripGlobals, readOnly,
// readTargets), MIT License, Copyright (c) 2026 Kurt Buhler. Changed: no module state (Windows drive
// handling is decided by the path itself), and the git-action table is left out.

import { posix, resolve } from './paths.ts'

/** Splits a command line into simple commands: quotes, escapes and comments handled. */
export function segments(command: string, separators: string[] = []): string[][] {
  const out: string[][] = []
  let current: string[] = []
  let token = ''
  let quote = ''
  let hasToken = false
  const endToken = () => {
    if (hasToken) current.push(token)
    token = ''
    hasToken = false
  }
  const endSegment = () => {
    endToken()
    if (current.length) out.push(current)
    current = []
  }
  for (let i = 0; i < command.length; i++) {
    const char = command[i] ?? ''
    if (quote) {
      if (char === quote) quote = ''
      else if (char === '\\' && quote === '"' && i + 1 < command.length) token += command[++i]
      else token += char
    } else if (char === '"' || char === "'") {
      quote = char
      hasToken = true
    } else if (char === '\\' && i + 1 < command.length) {
      token += command[++i]
      hasToken = true
    } else if (char === '#' && !hasToken) {
      while (i + 1 < command.length && command[i + 1] !== '\n') i++
    } else if (char === ' ' || char === '\t') endToken()
    else if (char === '\n' || char === ';') {
      separators.push(';')
      endSegment()
    } else if (char === '&' && (command[i - 1] === '>' || command[i + 1] === '>')) {
      token += char
      hasToken = true
    } else if (char === '&' || char === '|') {
      const isDouble = command[i + 1] === char
      if (isDouble) i++
      separators.push(isDouble ? char + char : char)
      endSegment()
    } else {
      token += char
      hasToken = true
    }
  }
  endSegment()
  if (!quote) return out
  // An unclosed quote: fall back to splitting on the separators alone.
  separators.push(';')
  return command.split(/&&|\|\||;|\||\n/).map(part => part.trim().split(/\s+/).filter(Boolean)).filter(part => part.length > 0)
}

function stripGlobals(tokens: string[]): string[] {
  const out = [...tokens]
  if (out[0] === 'env') out.shift()
  while (out.length && /^[A-Z_][A-Z0-9_]*=/.test(out[0] ?? '')) out.shift()
  return out
}

function gitVerbAt(tokens: string[]): number {
  let i = 1
  while (i < tokens.length && (tokens[i] ?? '').startsWith('-')) {
    if (tokens[i] === '-C' || tokens[i] === '-c') i++
    i++
  }
  return i
}

const READ_ONLY_GIT = new Set(['status', 'log', 'diff', 'show', 'blame', 'rev-parse', 'ls-files', 'grep', 'describe',
  'config', 'remote', 'reflog', 'shortlog', 'help', 'version', 'check-ignore'])

function isGitReadOnly(verb: string, rest: string[]): boolean {
  if (!verb || READ_ONLY_GIT.has(verb)) return true
  if (verb === 'stash') return ['list', 'show'].includes(rest[0] ?? '')
  if (verb === 'branch') return rest.every(token => token.startsWith('-'))
  if (verb === 'tag') return rest.length === 0 || rest.some(token => /^(-l|--list|-n\d*|--contains|--points-at|--merged|--no-merged|-v|--verify)$/.test(token))
  return false
}

const READERS = new Set(['rg', 'grep', 'egrep', 'fgrep', 'find', 'fd', 'fdfind', 'cat', 'head', 'tail', 'bat', 'less',
  'more', 'ls', 'eza', 'tree', 'wc', 'sed', 'awk', 'jq'])
const PATTERN_FIRST = new Set(['rg', 'grep', 'egrep', 'fgrep', 'sed', 'awk', 'jq'])
const PRINTS_PATHS = new Set(['rg', 'grep', 'egrep', 'fgrep', 'find', 'fd', 'fdfind'])
const WRITE_FLAGS = /^-(delete|exec|execdir|ok|okdir|fprint\w*|fls|x|X|-exec|-exec-batch)$/

/** Whether the command only reads (no redirects into files, no writing verbs). */
export function isReadOnly(command: string): boolean {
  const bare = ` ${command}`.replace(/\d*>&\d/g, ' ').replace(/(\d*|&)>>?\s*\/dev\/null/g, ' ')
  if (/[^>]>[^>&]|>>/.test(bare)) return false
  return segments(command).every(raw => {
    const tokens = stripGlobals(raw)
    const head = tokens[0]?.split('/').pop() ?? ''
    if (['cd', 'echo', 'printf', 'true', 'pwd'].includes(head)) return true
    if (head === 'git') {
      const at = gitVerbAt(tokens)
      return isGitReadOnly(tokens[at] ?? '', tokens.slice(at + 1))
    }
    if (head === 'sed') return !tokens.some(token => /^-i/.test(token))
    if (head === 'find' || head === 'fd' || head === 'fdfind') return !tokens.some(token => WRITE_FLAGS.test(token))
    return READERS.has(head)
  })
}

/** The files and folders a command reads: its arguments, plus paths that searchers print (up to 60). */
export function readTargets(command: string, sessionCwd: string, stdout: string, home = ''): string[] {
  let cwd = sessionCwd
  const out = new Set<string>()
  let printsPaths = false
  for (const raw of segments(command)) {
    const tokens = stripGlobals(raw).map(token => posix(token.replace(/^["']|["']$/g, '')))
    const head = tokens[0]?.split('/').pop() ?? ''
    if (head === 'cd' && tokens[1]) {
      cwd = resolve(cwd, tokens[1], home)
      continue
    }
    if (!READERS.has(head)) continue
    if (head === 'sed' && tokens.some(token => /^-i/.test(token))) continue
    if (PRINTS_PATHS.has(head)) printsPaths = true
    const args = tokens.slice(1)
    let skipPattern = PATTERN_FIRST.has(head) && !args.some(token => token === '-e' || token === '-f' || token === '--files')
    for (let i = 0; i < args.length; i++) {
      const arg = args[i] ?? ''
      if (arg.startsWith('-')) {
        if (/^-(e|f|g|t|T|m|A|B|C|-glob|-type|-max-count|name|iname|maxdepth|mindepth)$/.test(arg)) i++
        continue
      }
      if (skipPattern) {
        skipPattern = false
        continue
      }
      if (/[*?<>|$`]/.test(arg)) continue
      out.add(resolve(cwd, arg, home))
    }
  }
  if (printsPaths) {
    for (const line of stdout.split('\n').slice(0, 400)) {
      const path = posix(line).match(/^((?:[A-Za-z]:)?[^:\0]+?)(?::\d+[:-]|$|:)/)?.[1]?.trim()
      if (path && !path.includes(' ')) out.add(resolve(cwd, path, home))
    }
  }
  return [...out].slice(0, 60)
}
