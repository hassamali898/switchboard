// Git output parsers for the Files tree: `status --porcelain=v1 -z -b`, `--numstat -z`, and the
// branch line. Pure; register.tsx runs git with `--no-optional-locks` and hands the output here.
// parseBranch, the status letters and parseNumstat are ported from data-goblin/claude-code-filetree
// (hooks/tree.ts), MIT License, Copyright (c) 2026 Kurt Buhler. Changed: paths stay relative to the
// project root, and the counts Switchboard shows are added.

import type { FileChange } from '../../../types/index.d.ts'

export type BranchInfo = { head: string; upstream: string; ahead: number; behind: number; isDetached: boolean; hasCommits: boolean }

export function parseBranch(record: string): BranchInfo {
  const body = record.replace(/^## /, '')
  if (body.startsWith('HEAD (no branch)')) {
    return { head: 'detached', upstream: '', ahead: 0, behind: 0, isDetached: true, hasCommits: true }
  }
  const hasCommits = !/^(No commits yet on |Initial commit on )/.test(body)
  const head = body.match(/^(?:No commits yet on |Initial commit on )?(.+?)(?:\.\.\.|\s|$)/)?.[1] ?? body
  return {
    head,
    upstream: body.match(/\.\.\.(\S+)/)?.[1] ?? '',
    ahead: Number(body.match(/ahead (\d+)/)?.[1] ?? 0),
    behind: Number(body.match(/behind (\d+)/)?.[1] ?? 0),
    isDetached: false,
    hasCommits,
  }
}

export type Status = {
  branch: BranchInfo | null
  /** Changed files by path relative to the project root. */
  files: Record<string, FileChange>
  /** Untracked folders (git lists them once, with a trailing slash), relative. */
  untrackedDirs: string[]
}

/**
 * Parses `git status --porcelain=v1 -z -b`. `prefix` is the project root inside the repository
 * (`git rev-parse --show-prefix`): paths outside it are dropped, the rest made relative to it.
 */
export function parseStatus(stdout: string, prefix = ''): Status {
  const files: Record<string, FileChange> = {}
  const untrackedDirs: string[] = []
  let branch: BranchInfo | null = null
  const parts = stdout.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const record = parts[i] ?? ''
    if (record.startsWith('## ')) {
      branch = parseBranch(record)
      continue
    }
    if (record.length < 4) continue
    const xy = record.slice(0, 2)
    const raw = record.slice(3)
    let from: string | undefined
    if (xy[0] === 'R' || xy[0] === 'C') from = parts[++i]
    if (xy === '!!' || !raw.startsWith(prefix)) continue
    const path = raw.slice(prefix.length)
    if (xy === '??' && path.endsWith('/')) {
      untrackedDirs.push(path.replace(/\/$/, ''))
      continue
    }
    const kind: FileChange['kind'] = xy === '??' || (xy.includes('A') && !xy.includes('D')) ? 'new'
      : xy.includes('D') && !/U/.test(xy) ? 'deleted'
      : xy[0] === 'R' ? 'renamed'
      : /U/.test(xy) || xy === 'AA' || xy === 'DD' ? 'conflict' : 'modified'
    files[path] = { kind, isStaged: xy[0] !== ' ' && xy[0] !== '?',
      ...(kind === 'renamed' && from?.startsWith(prefix) ? { from: from.slice(prefix.length) } : {}) }
  }
  return { branch, files, untrackedDirs }
}

/** Parses `git diff --numstat -z` (or `git show --numstat -z`) into lines added and removed per file. */
export function parseNumstat(stdout: string, prefix = ''): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {}
  const parts = stdout.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const record = parts[i] ?? ''
    const match = record.match(/^(-|\d+)\t(-|\d+)\t(.*)$/s)
    if (!match) continue
    let path = match[3] ?? ''
    if (path === '') {
      // A rename: the old and new names follow as their own records; count it under the new one.
      i += 2
      path = parts[i] ?? ''
    }
    if (!path || !path.startsWith(prefix)) continue
    const rel = path.slice(prefix.length)
    const previous = out[rel] ?? [0, 0]
    out[rel] = [previous[0] + (match[1] === '-' ? 0 : Number(match[1])), previous[1] + (match[2] === '-' ? 0 : Number(match[2]))]
  }
  return out
}

/** Lines added and removed in total. */
export function totals(diff: Record<string, [number, number]>): { add: number; del: number } {
  let add = 0
  let del = 0
  for (const [plus, minus] of Object.values(diff)) {
    add += plus
    del += minus
  }
  return { add, del }
}

/** Splits NUL-separated names (`git diff-tree --name-only -z`, `ls-files -z`). */
export const parseNames = (stdout: string): string[] => stdout.split('\0').filter(Boolean)
