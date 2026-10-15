// Blast Radius's state: the one held command, the ones queued behind it, pauses and a short log.
// Pure; register.tsx holds the tool call and keeps this in `$.state`.

import type { BlastDecision, BlastHeld, BlastReport, BlastRow, BlastState } from '../../../types/index.d.ts'
import { SHOWN_ROWS, size } from './measure.ts'

export type { BlastDecision, BlastHeld, BlastState }

/** The pane stays this long after a Delete so you see what went, then what was under it comes back. */
export const CLOSE_AFTER_MS = 3_000
const MAX_LOG = 20

export function initialBlast(): BlastState {
  return { held: null, queued: 0, pausedUntil: 0, log: [] }
}

export function hold(state: BlastState, id: string, kind: string, agent?: string): BlastState {
  const held: BlastHeld = { id, kind, report: null, decision: null, phase: 'measuring', struck: [], isExpanded: false, isInBand: false,
    autoRunAt: null, now: 0,
    ...(agent ? { agent } : {}) }
  return { ...state, held }
}

/** Only the call that is held now, and only once. */
export function decide(state: BlastState, id: string, decision: BlastDecision): BlastState {
  const held = state.held
  if (!held || held.id !== id || held.decision !== null) return state
  return { ...state, held: { ...held, decision } }
}

export function withHeld(state: BlastState, id: string, change: (held: BlastHeld) => BlastHeld): BlastState {
  return state.held?.id === id ? { ...state, held: change(state.held) } : state
}

export function release(state: BlastState, id: string): BlastState {
  return state.held?.id === id ? { ...state, held: null } : state
}

export function logged(state: BlastState, command: string, outcome: string, at: number): BlastState {
  return { ...state, log: [{ command, outcome, at }, ...state.log].slice(0, MAX_LOG) }
}

/** What to tell Claude when the command is refused: never retry unless asked. */
export function denyText(why: string, report: BlastReport | null): string {
  const would = report && report.amount ? ` It would have: ${report.verb} ${report.amount}.` : ''
  return `Blast Radius held this command and did not run it: ${why}.${would} Do not retry it unless the user asks you to.`
}

export const WHY: Record<string, string> = {
  cancel: 'the user pressed Cancel',
  closed: 'the user closed the Blast Radius pane',
  interrupted: 'the turn was interrupted',
  error: 'Blast Radius hit an error while holding it',
}

/** The rows on screen and what the card says about the rest. */
export function visibleRows(report: BlastReport, isExpanded: boolean): { rows: BlastRow[]; hidden: number; moreLine: string } {
  const rows = isExpanded ? report.rows : report.rows.slice(0, SHOWN_ROWS)
  const moreLine = report.more > 0
    ? `+ ${report.more} more ${report.more === 1 ? 'file' : 'files'}${report.moreBytes > 0 ? ` · ${size(report.moreBytes)}` : ''}` : ''
  return { rows, hidden: report.rows.length - rows.length, moreLine }
}

/**
 * How long a held command waits before it runs by itself: "30s", "1m", "5m", "1h", "90" (seconds);
 * "none" (or "off", "never") waits until you choose, as null; undefined when it can't be read.
 * At least 5 seconds, at most a day.
 */
export function waitLength(text: string): number | null | undefined {
  const value = text.trim().toLowerCase()
  if (['none', 'off', 'never', 'no'].includes(value)) return null
  let ms = 0
  if (/^\d+$/.test(value)) ms = Number(value) * 1_000
  else {
    const match = value.match(/^(?:(\d+)h)?\s*(?:(\d+)m(?:in)?)?\s*(?:(\d+)s(?:ec)?)?$/)
    if (!match || (!match[1] && !match[2] && !match[3])) return undefined
    ms = ((Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0)) * 60 + Number(match[3] ?? 0)) * 1_000
  }
  return ms >= 5_000 && ms <= 24 * 3_600_000 ? ms : undefined
}

/** "1 min", "30 s", "1 h 30 min", "no time limit". */
export function waitWords(ms: number | null): string {
  if (ms === null) return 'until you choose'
  const seconds = Math.round(ms / 1_000)
  const h = Math.floor(seconds / 3_600)
  const m = Math.floor((seconds % 3_600) / 60)
  const s = seconds % 60
  return [h ? `${h} h` : '', m ? `${m} min` : '', s ? `${s} s` : ''].filter(Boolean).join(' ')
}

/** "0:42": what is left before it runs by itself. */
export function countdown(held: BlastHeld): string {
  if (held.autoRunAt === null) return ''
  const seconds = Math.max(0, Math.ceil((held.autoRunAt - held.now) / 1_000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** "1h", "30m", "2h30m", "90" (minutes): how long `/sb-blast off` pauses; 0 when it can't be read. */
export function pauseLength(text: string): number {
  const value = text.trim().toLowerCase()
  if (!value) return 60 * 60_000
  if (/^\d+$/.test(value)) return Number(value) * 60_000
  const match = value.match(/^(?:(\d+)h)?\s*(?:(\d+)m(?:in)?)?$/)
  if (!match || (!match[1] && !match[2])) return 0
  return (Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0)) * 60_000
}

/** The one line the Switchboard pane shows for Blast Radius. */
export function statusLine(state: BlastState, now: number): string {
  if (state.held) return state.queued ? `holding · ${state.queued} more` : 'holding a command'
  if (state.pausedUntil > now) return `paused until ${clock(state.pausedUntil)}`
  return 'watching'
}

export const clock = (ms: number) => {
  const date = new Date(ms)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
