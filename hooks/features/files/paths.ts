// Path helpers for the Files tree. POSIX-style paths throughout; Windows drive paths are normalized.
// Ported from data-goblin/claude-code-filetree (hooks/tree.ts, hooks/git.ts), MIT License,
// Copyright (c) 2026 Kurt Buhler. Changed: trimmed to what Switchboard uses; no module state.

export const posix = (path: string): string => path.replace(/\\/g, '/')

export const isAbsolute = (path: string): boolean => path.startsWith('/') || /^[A-Za-z]:\//.test(posix(path))

export function join(dir: string, name: string): string {
  return dir.endsWith('/') ? dir + name : `${dir}/${name}`
}

export function dirname(path: string): string {
  const clean = path.replace(/\/+$/, '')
  const at = clean.lastIndexOf('/')
  if (at < 0) return '.'
  if (at === 0) return '/'
  return /^[A-Za-z]:$/.test(clean.slice(0, at)) ? `${clean.slice(0, at)}/` : clean.slice(0, at)
}

export const basename = (path: string): string => path.replace(/\/+$/, '').split('/').pop() ?? path

/** Whether `path` is `root` or under it. */
export function inside(root: string, path: string): boolean {
  return path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`)
}

/** `path` relative to `root` ('' for the root itself). */
export function relative(root: string, path: string): string {
  return path === root ? '' : path.slice(root.endsWith('/') ? root.length : root.length + 1)
}

function tidy(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  return trimmed === '' ? '/' : /^[A-Za-z]:$/.test(trimmed) ? `${trimmed}/` : trimmed
}

/** Resolves `path` against `cwd` (`~` against `home`), folding `.` and `..`. */
export function resolve(cwd: string, path: string, home = ''): string {
  let p = posix(path)
  if (home && (p === '~' || p.startsWith('~/'))) p = home + p.slice(1)
  const drive = isAbsolute(p) && !p.startsWith('/') ? p.slice(0, 2) : ''
  const parts = isAbsolute(p) ? [drive] : posix(cwd).replace(/\/+$/, '').split('/')
  for (const segment of p.slice(drive.length).split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (parts.length > 1) parts.pop()
    } else parts.push(segment)
  }
  return tidy(parts.join('/'))
}

