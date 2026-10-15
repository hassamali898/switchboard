// Switchboard's shared types and the values it keeps in `$.state` for the session. Self-contained, as
// the engine requires of a contract: the hooks import their types from here, never the other way.

export type FeatureId = 'inbox' | 'agents' | 'files' | 'replay' | 'blast' | 'reflect' | 'cache' | 'browser'

export type SwitchboardSettings = {
  version: 2
  features: Record<FeatureId, boolean>
  autoOpen: { agents: boolean; files: boolean }
  /** Blast Radius: how long a held command waits for you before it runs by itself; null waits until you choose. */
  blastWaitMs: number | null
  /** Quiet hours mute everything but meetings; "HH:MM" local time. */
  quietHours: { from: string; to: string }
  /** The session that is the Inbox (BUILD_PLAN.md 5.3); absent until /sb-inbox makes one. */
  inboxSessionId?: string
  /** The Inbox shows the watcher's demo items instead of your accounts (/sb-inbox demo on). */
  inboxDemo?: boolean
  /** Inbox alerts for Critical items and meetings (the Inbox sources screen). */
  alerts: { leadMin: number; isSound: boolean; isNotify: boolean; isQuiet: boolean }
}

/** The Inbox sources screen: how each source connects, read from the watcher and this session's connectors. */
export type InboxSetup = {
  slack: { user: boolean; app: boolean; connector: boolean }
  gmail: { mode: string; connector: boolean; signedIn: boolean; client: boolean }
  calendar: boolean
  github: boolean
  jira: boolean
  safety: Record<string, { state: string; until: number; reason: string }>
  links: Record<string, string>
  /** Which source's setup steps are open. */
  steps: '' | 'slack' | 'gmail'
  /** A step running now ("slack-user", "gmail"), its result, or why it failed. */
  busy: string
  message: string
  error: string
  isLoaded: boolean
}

/** `Settings` is also an engine type name, so the state block below uses the long name. */
export type Settings = SwitchboardSettings

export type PaneReason = 'hold' | 'user' | 'auto'

export type PaneView = {
  /** The feature that drew it, or `control` for the Switchboard pane. */
  owner: string
  /** Which screen of that feature (`main`, `auto`, ...). */
  view: string
  title: string
  reason: PaneReason
  /** You clicked or typed in it: automatic closing no longer applies. */
  isTouched?: boolean
}

export type CardKind = 'meeting' | 'blast' | 'cache' | 'check' | 'rule' | 'needs' | 'reflect'

export type Card = {
  /** Unique per thing shown (`reflect:<rule id>`); a second push with the same id replaces it. */
  id: string
  kind: CardKind
  /** When it was asked for; older first among equals. */
  at: number
  /** It leaves the queue unseen after this (Reflect: 30 minutes). */
  expiresAt?: number
}

export type ArbiterState = {
  pane: PaneView | null
  /** What a hold replaced; it comes back when the hold is released. */
  under: PaneView | null
  /** `owner:view` of automatic opens you closed: not reopened by themselves this session. */
  blockedAuto: string[]
  cards: Card[]
}

// ---- Files (phase 1) -----------------------------------------------------------------------------

/** How git sees a file (git status). */
export type FileChange = { kind: 'new' | 'modified' | 'deleted' | 'renamed' | 'conflict'; isStaged: boolean; from?: string }

/** A file or folder in a loaded folder of the tree. `path` is relative to the project root. */
export type FileNode = { path: string; name: string; isDir: boolean; isHidden: boolean; mtimeMs: number; size: number }

export type TouchHow = 'reading' | 'read' | 'searching' | 'editing' | 'edited' | 'committed'

/** A file Claude touched this turn: relative to the root, or absolute when outside it. */
export type Touch = { path: string; isOutside: boolean; how: TouchHow; at: number; add?: number; del?: number; agent?: string }

export type FilesActivity = { kind: 'idle' | 'reading' | 'searching' | 'editing' | 'done'; path: string; at: number }

export type FilesState = {
  /** The project folder the tree shows, absolute. */
  root: string
  /** You picked it with /sb-files <path>: it no longer follows the session's folder. */
  isPinned: boolean
  isGit: boolean
  /** The root inside the repository (`git rev-parse --show-prefix`). */
  prefix: string
  branch: string
  isDetached: boolean
  hasCommits: boolean
  /** Children of each loaded folder, by its path ('' is the root). */
  nodes: Record<string, FileNode[]>
  expanded: string[]
  showHidden: boolean
  status: Record<string, FileChange>
  diff: Record<string, [number, number]>
  activity: FilesActivity
  touched: Touch[]
  commit: { sha: string; files: string[]; add: number; del: number } | null
  /** A push this turn: the branch it went to; '' when none. */
  pushed: string
  /** A pull request Claude acted on this turn ("PR #482 created"). */
  pr: { number: number; action: string } | null
  /** Shown in place of the tree when a folder can't be read. */
  error: string
  /** "Find a file": what you typed and the paths that match (relative), up to 60. */
  search: FilesSearch
  /** Show sizes: sizes on the right instead of times; folder sizes (bytes) as `du` found them. */
  showSizes: boolean
  sizes: Record<string, number>
  /** The session the marks belong to: after /clear or a resume they start over. */
  sessionId: string
}

export type FilesSearch = { query: string; matches: string[]; isLoading: boolean; total: number }

// ---- Replay (phase 2) ----------------------------------------------------------------------------

/** One diff line: unchanged, removed, added, or `~` for lines left out between changes. */
export type DiffLine = { op: ' ' | '-' | '+' | '~'; text: string }

export type ReplayStep = {
  /** Relative to the project root, or absolute when outside it. */
  path: string
  isOutside: boolean
  tool: string
  /** "new file", "replace all", "cell abc" ... */
  note: string
  lines: DiffLine[]
  add: number
  del: number
  /** Diff lines left out past the stored cap. */
  cut: number
  kind: 'edit' | 'created' | 'deleted' | 'binary'
  /** You changed Claude's proposal before accepting it. */
  isUserModified: boolean
  /** A subagent's edit: its type. */
  agent?: string
  /** Arrived after the turn ended (a background agent or command). */
  isAfterTurn: boolean
  at: number
}

export type ReplayTurn = { id: string; at: number; prompt: string; steps: ReplayStep[] }

export type ReplayState = {
  /** Finished turns with edits, newest first, at most 3. */
  turns: ReplayTurn[]
  /** The running turn's edits so far. */
  pending: ReplayStep[]
  /** The turn the pane shows (an index into `turns`) and the step in it. */
  turn: number
  step: number
  /** Show every stored line of the current step, not the first 60. */
  isFull: boolean
  /** A turn finished while the pane showed an older one. */
  hasNew: boolean
  /** "▶ 4 edits · Replay" above the prompt, until the next prompt. */
  isHinted: boolean
}

// ---- Blast Radius (phase 3) -----------------------------------------------------------------------

/** One line of the held command's report: a folder, a file, a commit, a path or a migration. */
export type BlastRow = {
  kind: 'folder' | 'file' | 'commit' | 'path' | 'migration'
  name: string
  /** What the row stands for (relative to where it runs), to strike it through once it's gone. */
  path: string
  isIndented: boolean
  /** "6 files", "+12 −3". */
  count: string
  /** "234 KB", or a folder for dirty files. */
  size: string
  /** Share of the whole for the size bar, 0..1; -1 draws no bar. */
  bar: number
}

export type BlastReport = {
  /** The risky part, as typed ("rm -rf build"). */
  command: string
  /** "will delete", "will discard". */
  verb: string
  /** "9 files · 286 KB". */
  amount: string
  /** "in demo-app". */
  where: string
  /** The red line ("None of these are tracked by git ..."), or ''. */
  warn: string
  rows: BlastRow[]
  /** Files not listed in the rows, and their bytes (-1: unknown). */
  more: number
  moreBytes: number
  note: string
  /** The primary button: "Delete 9 files", "Discard changes". */
  action: string
  /** Measured, and it changes nothing: not held. */
  isEmpty: boolean
}

export type BlastDecision = 'proceed' | 'cancel'

export type BlastHeld = {
  id: string
  /** What kind of risk (`rm`, `git-reset` ...): the tile's icon. */
  kind: string
  report: BlastReport | null
  /** A subagent's command: its type. */
  agent?: string
  decision: BlastDecision | null
  phase: 'measuring' | 'waiting' | 'running' | 'done' | 'refused'
  /** Rows whose path is gone after it ran. */
  struck: string[]
  isExpanded: boolean
  /** The pane couldn't be placed: drawn in the band's card slot instead. */
  isInBand: boolean
  /** When it runs by itself if you don't answer (ms), or null to wait until you choose. */
  autoRunAt: number | null
  /** The clock the countdown reads, ticked by the hold loop each second. */
  now: number
}

export type BlastState = {
  held: BlastHeld | null
  /** Risky commands waiting behind the held one. */
  queued: number
  /** `/sb-blast off 1h`: holds pause until then (ms). */
  pausedUntil: number
  /** The last holds and what happened to them. */
  log: { command: string; outcome: string; at: number }[]
}

// ---- Agents (phase 4) -----------------------------------------------------------------------------
// Display only: Switchboard runs no agents of its own. It watches the subagents Claude starts and
// draws them (screen F1).

export type AgentRunStatus = 'running' | 'done' | 'stopped' | 'failed'

/** One subagent run. */
export type AgentRun = {
  /** The agent's id (`agent.spawn`'s `agentId`). */
  id: string
  /** The agent type: `general-purpose`, `Explore` ... */
  type: string
  description: string
  model: string
  effort?: string
  status: AgentRunStatus
  /** Why it failed: "refused", "error". */
  failure?: string
  startedAt: number
  endedAt?: number
  /** The latest request's context, and the model's window. */
  contextTokens: number
  contextMax: number
  tokens: number
  /** ≈ from step usage; -1 when the model's price is unknown. */
  costUsd: number
  /** Model requests so far. */
  steps: number
  /** 1, or 2+ for a retry with the same description. */
  round: number
  parentId?: string
  isTeammate?: boolean
  /** The main turn that started it: runs started in one turn are one group. */
  group: string
}

export type AgentsState = {
  /** The latest group: the turn that started agents, titled from its prompt. */
  group: string
  title: string
  groupStartedAt: number
  runs: AgentRun[]
  /** The clock the drawings read; ticks each second only while something runs. */
  now: number
  isFinishedOpen: boolean
  /** The group whose band row you dismissed (✕). */
  hiddenGroup: string
  /** `$.session.usage()`: the session's cost, the same figure as /cost; -1 unknown. */
  sessionCost: number
}

// ---- Reflect (phase 5) -----------------------------------------------------------------------------

export type ReflectScope = 'project' | 'global'

/** A rule Reflect found in what you said. Kept in `$.store`; your message itself is never stored. */
export type ReflectItem = {
  id: string
  rule: string
  /** Where the model suggests it goes. */
  scope: ReflectScope
  /** The project folder it came from. */
  project: string
  confidence: number
  /** How many times you said it (×N). */
  count: number
  status: 'pending' | 'saved' | 'skipped'
  firstAt: number
  lastAt: number
}

export type ReflectState = {
  /** As last read from or written to the store. */
  items: ReflectItem[]
  /** What you said, by item id, for "From what you said": this session only, never stored. */
  quotes: Record<string, string>
  isPaused: boolean
  /** The card's chosen place (the options), by item id; the suggestion's own scope otherwise. */
  chosen: Record<string, ReflectScope>
  /** The item being reworded, '' when none. */
  rewording: string
  /** Rules saved this session: applied at once through the system prompt. */
  savedNow: { rule: string; scope: ReflectScope; project: string }[]
  /** claude-reflect is installed too: Reflect stays off and says so. */
  isConflicted: boolean
}

// ---- Cache Tax (phase 6) ---------------------------------------------------------------------------

/** How long the API keeps a prompt cache: learned per model, 1 hour until known. */
export type CacheTtl = '5m' | '1h'

/** The message held because the cache went cold, and what sending it costs. */
export type CacheHeld = {
  /** Your message as typed; this session only, never stored. */
  text: string
  at: number
  /** How long ago the cache went cold. */
  coldForMs: number
  /** Tokens a send re-writes. */
  tokens: number
  /** The cold send: the engine's own estimate when it gave one. Null: a model with no price. */
  coldUsd: number | null
  /** What a warm turn would have cost. */
  warmUsd: number | null
  /** The cache-write price, USD per million tokens. */
  writeRate: number | null
}

/** One cold write paid this session. */
export type CacheMiss = { at: number; tokens: number; usd: number | null }

/** The last keep-warm ping. */
export type CachePing = { at: number; read: number; write: number; usd: number | null; isWarm: boolean }

export type CacheState = {
  /** The main thread's last request (a ping counts); 0 before any. */
  lastRequestAt: number
  model: string
  /** Tokens the next request re-sends. */
  ctx: number
  /** Compacted since the last request: nothing to price until the next turn. */
  isCompacted: boolean
  /** The engine says the cache is cold (a resume past its TTL, a model switch) until the next request. */
  isForcedCold: boolean
  /** The engine's cold-write estimate for the next request (resume, model switch); null: work it out. */
  engineUsd: number | null
  /** Learned per model id. */
  ttls: Record<string, CacheTtl>
  /** `hold`: a cold send waits on the card; `warn`: it goes through with its price shown. */
  guard: 'hold' | 'warn'
  /** The `lastRequestAt` a message was held at: sending again while it stands goes through. */
  ackedAt: number
  /** The next turn pays a cold write knowingly: it is counted and keep-warm arms. */
  isPaying: boolean
  held: CacheHeld | null
  misses: CacheMiss[]
  /** Keep-warm ends at this time; 0 off. */
  deadline: number
  /** Ping period you set (`warm 2h every 10m`); 0: 50 min, or 4 min on a 5-minute cache. */
  every: number
  /** Keep-warm arms itself for 6 h at each session start. */
  isAlways: boolean
  lastPing: CachePing | null
  /** Why keep-warm stopped by itself, shown until it is armed again. */
  stopped: string
  /** Gap before this turn's first request, and that request's usage: what teaches the TTL. */
  turn: { gapMs: number; prevCtx: number; first: { read: number; write: number } | null; isOpen: boolean }
  /** cache-tax is installed too: Cache Tax stays off and says so. */
  isConflicted: boolean
  now: number
}

// ---- Inbox (phase 7) -------------------------------------------------------------------------------

export type InboxSourceId = 'slack' | 'gmail' | 'calendar' | 'github' | 'jira'
export type InboxLevel = 'critical' | 'high' | 'normal' | 'quiet'

/** One message as the watcher queues it (watcher/items.py `to_json`), read defensively. */
export type InboxItem = {
  id: string
  /** The queue's short number (#12). */
  num: number
  source: InboxSourceId
  /** dm, mention, thread, mail, meeting, review_request, ci_failed, assigned, comment. */
  kind: string
  from: { name: string; handle: string; email: string }
  title: string
  /** The message as text; never sent to a model when `isExcluded`. */
  body: string
  url: string
  threadCount: number
  level: InboxLevel
  receivedAt: number
  isRead: boolean
  /** An excluded label or channel: listed, never sent to Claude. */
  isExcluded: boolean
  /** direct, connector or demo. */
  via: string
  /** The conversation it belongs to (a Gmail thread id, a Slack thread). */
  threadId: string
  /** Attachment names. */
  files: string[]
  /** What the source says about it: a meeting's times and people, an issue's status, a PR's repo. */
  details: Record<string, string | string[]>
}

export type InboxSourceState = { state: string; message: string }

export type ReplyOption = 'short' | 'detailed' | 'ask'

/** The message open in the Inbox pane (any session): what it says, and its reply or its actions. */
export type InboxReply = {
  id: string
  /** `view`: a source with actions but no reply (Calendar, GitHub, Jira). */
  phase: 'view' | 'drafting' | 'ready' | 'editing' | 'countdown' | 'sending' | 'sent' | 'error' | 'failed'
  option: ReplyOption
  /** The three drafts; '' until drafted. */
  drafts: Record<ReplyOption, string>
  /** "Ask a question" may come back as another kind of reply: its label. */
  thirdLabel: string
  /** Your edit, or an improved draft you took; it wins over the draft. */
  edited: string
  /** "Slack · DM with Ahmed Raza", from the watcher. */
  target: string
  /** Gmail: answer everyone on the thread. */
  replyAll: boolean
  /** Why drafting or a step failed (phase `error`), or why the send failed (phase `failed`). */
  error: string
  /** The send path's refusal code (`original_edited` offers "I re-read it · send"). */
  failCode: string
  /** A short note under the draft ("Your saved draft"). */
  note: string
  /** Sends at this time unless you press Undo. */
  sendAt: number
  /** The watcher's action id after the send: Undo deletes a Slack message by it. */
  actionId: string
  undo: string
  /** The whole message as fetched when opened ('' until then: the item's own text shows). */
  full: string
  /** Improve: choosing an instruction, waiting for Haiku, or showing before and after. */
  improve: 'off' | 'choosing' | 'working' | 'done'
  improved: string
  /** Jira: the issue's status and the statuses it can move to; writing a comment. */
  status: string
  choices: { id: string; name: string }[]
  isCommenting: boolean
  /** A step running now ("comment", "move", "draft"), drawn as busy. */
  busy: string
}

export type InboxState = {
  /** The watcher: not started, starting, the one watching, following another, demo items, or stopped. */
  mode: 'off' | 'starting' | 'watch' | 'tail' | 'demo' | 'error'
  /** Newest first, at most 300. */
  items: InboxItem[]
  sources: Record<string, InboxSourceState>
  /** The pane's source filter: 'all' or a source id. */
  filter: string
  query: string
  /** Needs-you cards you dismissed this session. */
  dismissed: string[]
  /** Needs-you cards you put off: shown again at this time. */
  remindAt: Record<string, number>
  reply: InboxReply | null
  /** The meeting card now: which meetings and which stage (phase 8). */
  meetingCard: { ids: string[]; stage: 'lead' | 'final' | 'start' } | null
  /** Haiku spent today on drafts, USD. */
  costToday: number
  /** This session is the Inbox session. */
  isHome: boolean
  /** The Inbox sources screen's facts, once opened. */
  setup: InboxSetup | null
  now: number
}

/** What a message asks for (the When side of a rule, phase 10). */
export type AutoAsk = 'question' | 'pr_review' | 'meeting' | 'fyi'
/** What the rule does about it (the Do side). */
export type AutoDo = 'reply' | 'review' | 'book' | 'archive'

export type AutoPair = { when: AutoAsk; whenText: string; do: AutoDo; doText: string }

export type AutoRule = {
  id: string
  /** "Ahmed Raza", "Replies". */
  name: string
  /** Whose messages it acts on; '' for anyone. */
  person: string
  /** Empty: every source the pairs fit. */
  sources: InboxSourceId[]
  pairs: AutoPair[]
  /** GitHub repos it may act in ("acme-*"); empty for any. */
  repos: string[]
  /** Only 09:00 to 18:00 on weekdays. */
  workHours: boolean
  /** Actions a day before the rule pauses until tomorrow. */
  cap: number
  /** New rules start in Ask first. */
  mode: 'ask' | 'auto'
  isOn: boolean
  /** Extra words from you for the drafts or the reviewer ("use my checklist"). */
  instructions: string
  createdAt: number
}

export type AutoTaskState = 'running' | 'waiting' | 'sending' | 'done' | 'skipped' | 'stopped' | 'interrupted' | 'failed'

export type AutoTask = {
  id: string
  ruleId: string
  ruleName: string
  itemId: string
  do: AutoDo
  state: AutoTaskState
  /** "Reply to Sara Khan", "Review acme-api #482". */
  title: string
  /** Where it goes ("Gmail · reply to sara@…"). */
  target: string
  /** The reply that would go, or what the agent will do. */
  text: string
  /** Your edit, sent in place of `text`. */
  edited: string
  startedAt: number
  /** Why it stopped, failed or was skipped; the agent's answer when done. */
  note: string
  /** The watcher's action-log id once something was done. */
  actionId: string
  /** The subagent doing it (review, book). */
  agentId: string
}

export type AutoLogEntry = { at: number; text: string; actionId: string; undo: string; isUndone: boolean }

/** The rule /sb-auto is making: Haiku's card waits for Save rule. */
export type AutoDraft = { phase: 'making' | 'ready' | 'error' | 'saved'; request: string; rule: AutoRule | null; error: string }

export type AutoState = {
  /** The master switch. Off: rules wait, nothing is matched. */
  isOn: boolean
  /** /sb-pause: everything stopped until you resume. */
  isPaused: boolean
  /** Highest first: when two match, the higher one wins. */
  rules: AutoRule[]
  /** Today's tasks, newest first. */
  tasks: AutoTask[]
  /** Today's log, newest first. */
  log: AutoLogEntry[]
  /** Actions per rule today, for the daily cap. */
  used: { day: string; byRule: Record<string, number> }
  /** Haiku spent today on matching and drafts, USD. */
  costToday: number
  draft: AutoDraft | null
  /** The task the send check shows, '' for none. */
  checkId: string
  /** Rewording the reply in the send check. */
  isEditing: boolean
  now: number
}

declare module 'claude-code' {
  interface PluginState {
    switchboard: {
      /** What the pane and the band show (hooks/core/arbiter.ts). */
      arbiter: ArbiterState
      /** Feature switches and options as last read from or written to `$.store`. */
      prefs: SwitchboardSettings
      /** The key of the picture part under the pointer (`toggle:files`), or '': drawn as its hover. */
      hover: string
      /** The Files tree (phase 1). */
      files: FilesState
      /** Replay's turns and where the pane is (phase 2). */
      replay: ReplayState
      /** The command Blast Radius holds, if any (phase 3). */
      blast: BlastState
      /** Subagents Claude runs (phase 4). */
      agents: AgentsState
      /** Rules found in what you said, waiting for you (phase 5). */
      reflect: ReflectState
      /** The prompt cache, the held message and keep-warm (phase 6). */
      cache: CacheState
      /** The inbox: items from the watcher, the pane's filters, the reply being written (phase 7). */
      inbox: InboxState
      /** Auto rules, their tasks and today's log (phase 10). */
      auto: AutoState
      /** The band's clock while the meeting card counts down (ms). */
      tick: number
      /** One line per feature for the Switchboard pane ("3 running", "warm"). */
      statuses: Partial<Record<FeatureId, string>>
    }
  }
}
