// The features Switchboard is made of, and the slash commands that reach them. Nothing here calls
// the engine: register.tsx reads these tables. Each feature is separate; none depends on another.

import type { FeatureId } from '../../types/index.d.ts'

export type { FeatureId }

/** Theme color names (see theme.ts) a feature's icon tile uses. */
export type Tone = 'amber' | 'orange' | 'teal' | 'pink' | 'red' | 'green' | 'blue' | 'faint'

export type Feature = {
  id: FeatureId
  name: string
  /** The command the Switchboard pane shows for it. */
  command: string
  description: string
  tone: Tone
  /** The build phase that brings it (BUILD_PLAN.md section 6). 0 means it works now. */
  phase: number
  /** Surfaces it can run on; absent means every one. */
  surfaces?: readonly string[]
  isOnByDefault: boolean
}

/** In the order the Switchboard pane lists them (screen 2). */
export const FEATURES: readonly Feature[] = [
  { id: 'inbox', name: 'Inbox', command: '/sb-inbox', tone: 'amber', phase: 7, isOnByDefault: true,
    description: 'Slack, Gmail, Calendar, GitHub, Jira · own session on Haiku' },
  { id: 'agents', name: 'Agents', command: '/sb-agents', tone: 'orange', phase: 4, isOnByDefault: true,
    description: 'Watch subagents work: steps, time and cost' },
  { id: 'files', name: 'Files', command: '/sb-files', tone: 'teal', phase: 1, isOnByDefault: true,
    description: 'Your project, live with what Claude reads and edits' },
  { id: 'replay', name: 'Replay', command: '/sb-replay', tone: 'pink', phase: 2, isOnByDefault: true,
    description: "Step through each turn's edits, one at a time" },
  { id: 'blast', name: 'Blast Radius', command: '/sb-blast', tone: 'red', phase: 3, isOnByDefault: true,
    description: 'Holds commands that delete or overwrite things' },
  { id: 'reflect', name: 'Reflect', command: '/sb-reflect', tone: 'green', phase: 5, isOnByDefault: true,
    description: 'Turns your corrections into rules for Claude' },
  { id: 'cache', name: 'Cache Tax', command: '/sb-cache', tone: 'orange', phase: 6, isOnByDefault: true,
    description: 'Holds a costly message when the cache has gone cold' },
  { id: 'browser', name: 'Browser', command: '/sb-browser', tone: 'faint', phase: 11, isOnByDefault: true,
    surfaces: ['terminal'], description: 'Live web pages in the side pane · kitty or Ghostty only' },
]

export function featureById(id: FeatureId): Feature {
  const found = FEATURES.find(feature => feature.id === id)
  if (!found) throw new Error(`unknown feature ${id}`)
  return found
}

/** Whether a feature can run where this session is drawn (Browser needs the terminal). */
export function isAvailable(feature: Feature, surfaces: readonly string[]): boolean {
  return !feature.surfaces || feature.surfaces.some(surface => surfaces.includes(surface))
}

/** Where a command may run. */
export type CommandScope = 'any' | 'inbox-session' | 'terminal'

export type CommandDef = {
  name: string
  /** The feature it belongs to; null for `/switchboard`, which is always there. */
  feature: FeatureId | null
  description: string
  argumentHint?: string
  /** Runs while a turn is going (BUILD_PLAN.md 4.5). */
  isImmediate: boolean
  scope: CommandScope
}

export const COMMANDS: readonly CommandDef[] = [
  { name: 'switchboard', feature: null, isImmediate: true, scope: 'any',
    description: 'Switchboard: turn features on or off and see what each is doing' },
  { name: 'sb-files', feature: 'files', isImmediate: true, scope: 'any', argumentHint: '[path | auto on|off]',
    description: 'Files: your project as a live tree, with what Claude reads and edits' },
  { name: 'sb-replay', feature: 'replay', isImmediate: true, scope: 'any', argumentHint: '[turn]',
    description: "Replay: step through a turn's edits one by one" },
  { name: 'sb-blast', feature: 'blast', isImmediate: true, scope: 'any', argumentHint: '[wait 1m | wait none | off 1h | on]',
    description: 'Blast Radius: held commands, history and pause' },
  { name: 'sb-agents', feature: 'agents', isImmediate: true, scope: 'any',
    description: 'Agents: show the subagents working now, with model, context, cost and time' },
  { name: 'sb-reflect', feature: 'reflect', isImmediate: true, scope: 'any', argumentHint: '[pause | resume]',
    description: 'Reflect: rules waiting for your review' },
  { name: 'sb-cache', feature: 'cache', isImmediate: true, scope: 'any', argumentHint: '[status | warm 6h|always|off | guard hold|warn]',
    description: 'Cache Tax: cache status, keep-warm and the guard' },
  { name: 'sb-inbox', feature: 'inbox', isImmediate: true, scope: 'any', argumentHint: '[here | sources | demo on|off | restart]',
    description: 'Inbox: open it, its sources, or make this the Inbox session' },
  { name: 'sb-auto', feature: 'inbox', isImmediate: false, scope: 'inbox-session', argumentHint: '<person>: <what to do> | rules | on | off | resume | delete <n>',
    description: 'Auto: set up a rule that replies, reviews or books for you, or open the Auto pane' },
  { name: 'sb-pause', feature: 'inbox', isImmediate: true, scope: 'any', argumentHint: '[1h]',
    description: 'Auto: pause every rule and running task' },
  { name: 'sb-browser', feature: 'browser', isImmediate: true, scope: 'terminal', argumentHint: '<url>',
    description: 'Browser: a live web page in the side pane' },
]

export type CommandContext = {
  enabled: ReadonlySet<FeatureId>
  isInboxSession: boolean
  surfaces: readonly string[]
}

/** Why a command can't run here, or undefined when it can. The same words the menu hides it for. */
export function blockedReason(command: CommandDef, context: CommandContext): string | undefined {
  if (command.scope === 'terminal' && !context.surfaces.includes('terminal')) {
    return `/${command.name} only works in a kitty or Ghostty terminal.`
  }
  if (command.scope === 'inbox-session' && !context.isInboxSession) {
    return `/${command.name} works in the Inbox session. Run /sb-inbox to open or make it.`
  }
  if (command.feature && !context.enabled.has(command.feature)) {
    return `${featureById(command.feature).name} is off. Turn it on in /switchboard.`
  }
  return undefined
}

/** Hidden from the typeahead whenever it can't run (BUILD_PLAN.md 4.5). */
export function isHidden(command: CommandDef, context: CommandContext): boolean {
  return blockedReason(command, context) !== undefined
}

export function commandByName(name: string): CommandDef | undefined {
  return COMMANDS.find(command => command.name === name)
}
