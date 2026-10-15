// Replay (screen F4): each edit Claude makes in a turn becomes a step, and the pane steps through
// them. Pure functions over ReplayState; register.tsx feeds in tool results and keeps the value in
// `$.state`, and the last 3 turns in `$.store`.

import type { DiffLine, ReplayState, ReplayStep, ReplayTurn } from '../../../types/index.d.ts'
import { basename, dirname } from '../files/paths.ts'
import { capLines, counts, diffTexts, hunkLines, splitLines, trimContext, type FileDiff } from './diff.ts'

export type { ReplayState, ReplayStep, ReplayTurn }

export const REPLAY_KEY = 'replay'
export const MAX_TURNS = 3
/** Diff lines a step shows until "Show full diff". */
export const SHOWN_LINES = 60
/** What the stored turns may take in `$.store`. */
export const REPLAY_CAP_BYTES = 1024 * 1024

export function initialReplay(): ReplayState {
  return { turns: [], pending: [], turn: 0, step: 0, isFull: false, hasNew: false, isHinted: false }
}

/** Where a file sits: relative to the project, or absolute outside it. register.tsx works it out. */
export type Place = { path: string; isOutside: boolean }

type StepInput = {
  place: Place
  tool: string
  note?: string
  /** The whole diff, context included: trimmed to one line around each change here. */
  lines: readonly DiffLine[]
  kind?: ReplayStep['kind']
  isUserModified?: boolean
  agent?: string
  at: number
}

export function stepOf(input: StepInput): ReplayStep {
  const kind = input.kind ?? 'edit'
  const { add, del } = counts(input.lines)
  const { lines, cut } = capLines(kind === 'binary' ? [] : trimContext(input.lines, 1))
  return {
    path: input.place.path, isOutside: input.place.isOutside, tool: input.tool, note: input.note ?? '', lines, add, del, cut, kind,
    isUserModified: !!input.isUserModified, ...(input.agent ? { agent: input.agent } : {}), isAfterTurn: false, at: input.at,
  }
}

type Hunk = { lines: readonly string[] }

/** The parts of an Edit or Write result Replay reads (2.1.295's records). */
export type EditRecord = {
  structuredPatch?: readonly Hunk[]
  originalFile?: string | null
  content?: string
  type?: 'create' | 'update'
  userModified?: boolean
  replaceAll?: boolean
  staged?: boolean
}

/** An Edit or Write that went through: one step, from the tool's own patch. */
export function editStep(tool: string, record: EditRecord, place: Place, at: number, agent?: string): ReplayStep | null {
  if (record.staged) return null
  const isCreate = record.type === 'create'
  let lines = record.structuredPatch?.length ? hunkLines(record.structuredPatch) : []
  if (!lines.length && isCreate && record.content !== undefined) lines = splitLines(record.content).map(text => ({ op: '+' as const, text }))
  else if (!lines.length && record.content !== undefined && record.originalFile) lines = diffTexts(record.originalFile, record.content)
  if (!lines.some(line => line.op !== ' ')) return null // nothing changed
  const note = isCreate ? 'new file' : record.replaceAll ? 'replace all' : ''
  return stepOf({ place, tool, note, lines, kind: isCreate ? 'created' : 'edit', isUserModified: !!record.userModified, at, ...(agent ? { agent } : {}) })
}

export type NotebookRecord = { old_source?: string; new_source?: string; cell_id?: string; edit_mode?: string; error?: string }

/** A NotebookEdit: the cell's source before and after. */
export function notebookStep(record: NotebookRecord, place: Place, at: number, agent?: string): ReplayStep | null {
  if (record.error) return null
  const isDelete = record.edit_mode === 'delete'
  const lines = diffTexts(record.old_source ?? '', isDelete ? '' : record.new_source ?? '')
  if (!lines.some(line => line.op !== ' ')) return null
  const verb = record.edit_mode === 'insert' ? 'new cell' : isDelete ? 'cell removed' : 'cell'
  return stepOf({ place, tool: 'NotebookEdit', note: record.cell_id ? `${verb} ${record.cell_id}` : verb, lines, at, ...(agent ? { agent } : {}) })
}

export type BashFileDiff = { filePath: string; hunks: readonly Hunk[]; created?: true; deleted?: true }

/** A shell command's edits from its result's `bashEditDiff`, one step per file. */
export function bashSteps(diffs: readonly BashFileDiff[], placeOf: (absolute: string) => Place, at: number, agent?: string): ReplayStep[] {
  return diffs.flatMap(diff => {
    const lines = hunkLines(diff.hunks)
    if (!lines.length && !diff.created && !diff.deleted) return []
    return [stepOf({ place: placeOf(diff.filePath), tool: 'Bash', note: diff.created ? 'new file' : diff.deleted ? 'deleted' : '',
      lines, kind: diff.created ? 'created' : diff.deleted ? 'deleted' : 'edit', at, ...(agent ? { agent } : {}) })]
  })
}

/** A shell command's edits from `git diff <before>` (paths relative to the session's folder). */
export function gitSteps(diffs: readonly FileDiff[], at: number, agent?: string): ReplayStep[] {
  return diffs.filter(diff => diff.kind === 'binary' || diff.lines.some(line => line.op !== ' ')).map(diff =>
    stepOf({ place: { path: diff.path, isOutside: false }, tool: 'Bash',
      note: diff.kind === 'created' ? 'new file' : diff.kind === 'deleted' ? 'deleted' : diff.from ? `renamed from ${basename(diff.from)}` : '',
      lines: diff.lines, kind: diff.kind, at, ...(agent ? { agent } : {}) }))
}

// ---- turns ---------------------------------------------------------------------------------------

/** New steps: into the running turn, or, after it ended, onto the last turn as "after the turn". */
export function addSteps(state: ReplayState, steps: readonly ReplayStep[], isTurnRunning: boolean): ReplayState {
  if (!steps.length) return state
  if (isTurnRunning || !state.turns.length) return { ...state, pending: [...state.pending, ...steps] }
  const [last, ...older] = state.turns
  const late = steps.map(step => ({ ...step, isAfterTurn: true }))
  return { ...state, turns: [{ ...last!, steps: [...last!.steps, ...late] }, ...older] }
}

/** A prompt: the hint goes until this turn's edits are in. */
export function onTurnStart(state: ReplayState): ReplayState {
  return { ...state, pending: [], isHinted: false }
}

/**
 * The turn ended. With edits it becomes the newest turn and the hint shows. When the pane is
 * showing an older turn, that one stays on screen and "New edits ready" appears.
 */
export function finishTurn(state: ReplayState, id: string, prompt: string, at: number, isShowing: boolean): ReplayState {
  if (!state.pending.length) return { ...state, pending: [] }
  const turn: ReplayTurn = { id, at, prompt: prompt.slice(0, 160), steps: state.pending }
  const turns = [turn, ...state.turns].slice(0, MAX_TURNS)
  if (isShowing && state.turns.length) {
    const kept = Math.min(state.turn + 1, turns.length - 1)
    return { ...state, turns, pending: [], turn: kept, hasNew: true, isHinted: true }
  }
  return { ...state, turns, pending: [], turn: 0, step: 0, isFull: false, hasNew: false, isHinted: true }
}

export const currentTurn = (state: ReplayState): ReplayTurn | undefined => state.turns[state.turn]

export function goTo(state: ReplayState, step: number): ReplayState {
  const total = currentTurn(state)?.steps.length ?? 0
  const next = Math.max(0, Math.min(step, total - 1))
  return next === state.step ? state : { ...state, step: next, isFull: false }
}

export function showTurn(state: ReplayState, turn: number): ReplayState {
  const next = Math.max(0, Math.min(turn, state.turns.length - 1))
  return { ...state, turn: next, step: 0, isFull: false, hasNew: next === 0 ? false : state.hasNew }
}

export type Summary = { edits: number; files: number; add: number; del: number }

export function summaryOf(turn: ReplayTurn | undefined): Summary {
  const steps = turn?.steps ?? []
  return {
    edits: steps.length, files: new Set(steps.map(step => step.path)).size,
    add: steps.reduce((sum, step) => sum + step.add, 0), del: steps.reduce((sum, step) => sum + step.del, 0),
  }
}

export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

/** "4 edits in 4 files". */
export const headline = (summary: Summary) => `${plural(summary.edits, 'edit')} in ${plural(summary.files, 'file')}`

/** The step's file name and where it is: "README.md, project root · Edit · new file". */
export function stepWhere(step: ReplayStep): string {
  const folder = step.isOutside ? dirname(step.path) : dirname(step.path) === '.' ? 'project root' : dirname(step.path)
  return [`${basename(step.path)}, ${folder}`, step.tool, step.note].filter(Boolean).join(' · ')
}

/** The notes under a step's name: who made it, and when. */
export function stepNotes(step: ReplayStep): string[] {
  return [
    step.isUserModified ? 'You changed this before accepting it' : '',
    step.agent ? `By agent ${step.agent}` : '',
    step.isAfterTurn ? 'After the turn ended' : '',
  ].filter(Boolean)
}

/** The one line the Switchboard pane shows for Replay. */
export function statusLine(state: ReplayState): string {
  const latest = state.turns[0]
  return latest ? `${plural(latest.steps.length, 'edit')} last turn` : 'nothing yet'
}

// ---- storage -------------------------------------------------------------------------------------

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length

/** The turns to store: the last 3, trimmed until they fit 1 MiB (oldest first, then long diffs). */
export function forStore(state: ReplayState, cap = REPLAY_CAP_BYTES): { version: 1; turns: ReplayTurn[] } {
  let turns = state.turns.slice(0, MAX_TURNS)
  while (turns.length > 1 && bytes(turns) > cap) turns = turns.slice(0, -1)
  if (bytes(turns) > cap) {
    turns = turns.map(turn => ({ ...turn, steps: turn.steps.map(step =>
      ({ ...step, lines: step.lines.slice(0, SHOWN_LINES), cut: step.cut + Math.max(0, step.lines.length - SHOWN_LINES) })) }))
  }
  return { version: 1, turns }
}

const isStep = (value: unknown): value is ReplayStep => {
  const step = value as ReplayStep
  return !!step && typeof step.path === 'string' && Array.isArray(step.lines) && typeof step.add === 'number' && typeof step.del === 'number'
}

/** Stored turns back, anything damaged dropped. */
export function fromStore(raw: unknown): ReplayTurn[] {
  const turns = (raw as { turns?: unknown } | null)?.turns
  if (!Array.isArray(turns)) return []
  return turns.filter((turn): turn is ReplayTurn =>
    !!turn && typeof turn.id === 'string' && Array.isArray(turn.steps) && turn.steps.every(isStep)).slice(0, MAX_TURNS)
}
