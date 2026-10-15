# Switchboard build plan (v2)

Status: approved 2026-10-11 with every recommendation in section 12. Phase 0 started on branch `v2`. Replaces the v1 plan's build order; v1 code is not reused.

Design: the `design/` folder. Every screen has a dark and a light version; the plan builds exactly those screens.

---

## 1. What we are building

Switchboard is one Claude Code plugin made of separate features. You switch each one on or off. None depends on another.

| Feature | What it does | Command | Where it shows |
|---|---|---|---|
| Switchboard | Turns features on or off, shows their status and settings | `/switchboard` | Side pane |
| Files | Your project as a live tree: what Claude is reading, what it edited, git status, commits | `/sb-files` | Side pane |
| Replay | Steps through a turn's edits one by one, with word-level diffs | `/sb-replay` | Side pane, plus a hint row above the prompt |
| Blast Radius | Holds a risky shell command and shows exactly what it would delete or overwrite | `/sb-blast` (history and settings) | Side pane while a command is held |
| Agents | Shows a multi-agent task: each agent's steps, time and cost | `/sb-flow` (start), `/sb-agents` (show) | Side pane, plus a progress row above the prompt |
| Reflect | Turns your corrections into rules saved to CLAUDE.md, after you approve | `/sb-reflect` | Card above the prompt |
| Cache Tax | Holds a message that would pay for a cold cache, and can keep the cache warm | `/sb-cache`, `/sb-cache warm 3h` | Card above the prompt |
| Inbox | Slack, Gmail, Calendar, GitHub and Jira in one place, in its own session on Haiku | `/sb-inbox` | Bell in every session; Inbox pane in the Inbox session |
| Auto (part of Inbox) | Rules that reply, review or book for you, Ask first by default | `/sb-auto`, `/sb-pause` | Inbox session: rule card in chat, Auto pane |
| Browser | A live web page in the side pane | `/sb-browser <url>` | kitty or Ghostty terminals only |

Skins (claude-skins) is out of scope.

### Where the code comes from

None of the seven reference repos draws our design, including their latest versions (checked 2026-10-11). So Switchboard reimplements each feature with its own UI, and ports the repos' detection logic where it is good. Licenses allow this as long as notices are kept:

| Our feature | Logic ported from | License |
|---|---|---|
| Files | data-goblin/claude-code-filetree | MIT |
| Replay | anthropics/claude-code-playground replay-theater | Apache-2.0 |
| Blast Radius | anthropics/claude-code-playground blast-radius | Apache-2.0 |
| Agents | JohnnyVizz/claude-kit savvy-progress and savvy-flow | MIT |
| Reflect | BayramAnnakov/claude-reflect (mod) | MIT |
| Cache Tax | karanb192/cache-tax | MIT |
| Browser | zenbu-labs/terminal-browser: we port its plugin glue and call its CLI; we do not copy its engine | MIT |

Every ported file keeps the original copyright line and says what we changed. `THIRD_PARTY_NOTICES.md` lists all of them. Apache-2.0 files carry a "modified by" note.

---

## 2. Ground rules

1. **Quiet by default.** A coding session shows nothing from Switchboard unless something needs you. The side pane opens only when a feature truly needs it (section 4).
2. **Nothing overlaps.** One side-pane slot, one card slot above the prompt, one bell. A single arbiter decides what shows. No feature draws on its own.
3. **Never auto-send without a rule.** Manual sends need a click. Auto actions run only through a saved rule that passes every check. Anything unsure becomes a normal item.
4. **Message content is data, never instructions.** No Slack message, email, PR, ticket or web page can change what Switchboard does beyond the matched rule's allowed actions.
5. **Account safety first.** Rate limits per source, backoff, and a full stop on rejected credentials. Never risk a provider blocking an account.
6. **Cheap.** The Inbox runs on Haiku 4.5. Background model calls name their model explicitly. Every model call has a cap.
7. **Everything is local.** No server, no cloud database. Secrets live in the OS keychain.
8. **Plain words and buttons.** Every action is a button. Commands exist for people who like typing, never as the only way.
9. **Both surfaces.** Desktop app (pixel design) and terminal (text design). Mobile and VS Code get a simple text fallback.
10. **Phase by phase.** Each phase ends at a gate tested on the real desktop app before the next phase starts.

Minimum version: Claude Code **2.1.295** (the desktop app's bundle on 2026-10-11). Terminal is 2.1.296. The checks run against both.

---

## 3. Screens to build

| # | Screen (canvas board) | Feature | Surface |
|---|---|---|---|
| 1 | A coding session: only what needs you | Inbox (bell + needs-you card) | Band |
| 2 | Switchboard: your features | Switchboard | Pane |
| 3 | The Inbox session | Inbox | Inbox session: chat + pane |
| 4 | Inbox: reply to a message | Inbox | Inbox session: chat card + pane |
| 5 | Inbox: an auto reply waits for you | Auto | Inbox session: chat card |
| 6 | A meeting is about to start | Inbox (Calendar) | Band card that takes the keyboard + OS notification |
| 7 | Inbox: auto rules and what they did | Auto | Inbox session: chat card + Auto pane |
| 8 | Slash commands | All | The app's own command menu |
| F1 | Agents | Agents | Pane + band row |
| F2 | Files · Claude is reading | Files | Pane |
| F3 | Files · done and committed | Files | Pane |
| F4 | Replay | Replay | Pane |
| F5 | Blast Radius | Blast Radius | Pane |
| F6 | Reflect · save as a rule | Reflect | Band card |
| F7 | Cache Tax · message on hold | Cache Tax | Notice + band card |
| F8 | Browser | Browser | Terminal pane |

Each screen has a light version. Shared look: Claude's warm palette, clay primary buttons, serif card titles, colored all-caps labels with a dot, rounded-square icon tiles, teal for "Claude is reading" and "drafted", no purple. Side panes are 580 px wide with a 1.5 px clay frame, 20 px corners, set 14 px in from the window edges. Corners: 20 framed panels, 16 cards and prompt, 12 inner rows, 11 buttons.

---

## 4. Showing only what's needed: the arbiter

Everything Switchboard shows goes through one module, `ui/arbiter.ts`. Features ask it to show something and never open panes or draw band rows themselves.

### 4.1 Surfaces we use

| Surface | API | Used for |
|---|---|---|
| Side pane | `$.ui.open` + `ui.render {component:'Pane'}` | Files, Replay, Blast Radius, Agents, Switchboard, Inbox, Auto |
| Card slot above the prompt | `ui.render {component:'AbovePrompt'}` | Meeting, Cache Tax hold, Reflect, needs-you, Blast fallback |
| Status row above the prompt | same band, one row under the card | Agents progress, Replay hint, bell chip |
| Chat cards | `CommandOutput` for our commands | `/sb-auto` rule card, `/sb-cache` status, `/sb-blast` history |
| OS notification | `$.ui.notify` (terminal); `osascript` on desktop, where `notify` answers `no-surface` (P0-12) | Meeting and Critical items only |
| Sound | `$.audio.play` | Meeting and Critical items only |
| Toast | `$.ui.toast` | Errors and confirmations ("Rule saved"), max 1 at a time |
| Status line | `$.ui.status` | Only on surfaces without a band (mobile, VS Code) |

### 4.2 The side pane: one slot

Switchboard opens **one pane id, `switchboard`**. Its title and content change with what it shows, so Switchboard never stacks several tabs. Other plugins' panes are not ours and are left alone.

**Who gets the slot**, highest first:

1. **Blast Radius hold.** Claude is blocked waiting for you. Takes the slot at once with `focus`, `closeOnEscape` and `holdToasts`. Whatever it replaced comes back after the decision.
2. **What you opened.** A command or button: `/sb-files`, `/sb-replay`, `/sb-agents`, `/switchboard`, a Files or Replay button on a card. It stays until you close it or open something else.
3. **The Inbox pane, in the Inbox session only.** It opens when that session starts, because it is the session's purpose.
4. **Automatic, and only when the setting is on:**
   - Agents: when a `/sb-flow` run starts 2 or more agents (on by default).
   - Files: when Claude starts reading or editing (off by default).
   - Never over something you opened yourself.

**Closing:**
- **You close it** (✕ or Esc): it stays closed. An automatic reopen for the same reason is blocked for the rest of the session.
- **Blast Radius:** closes 3 s after your decision, then the previous content comes back.
- **Agents (opened automatically):** closes 60 s after the run finishes, unless you touched it.
- **Files (opened automatically):** closes 20 s after the turn ends, unless you touched it.
- **Replay:** closes only by your hand.

**Width:** we ask for 580 px.
- The types define `columns` for the terminal's full-screen side dock and `rows` for the inline block. Both are requests, not grants, and a size you dragged always wins.
- Desktop may ignore both (probe P0-3). Then the app's default width applies, and the layout adapts down to 360 px.
- In the terminal the pane needs the full-screen layout. Panes we open without being asked need 144 columns.
- When `isPlaced` is false we fall back to the card slot (Blast) or do nothing (others).

**Keyboard focus is a request, not a grant.** The app refuses `focus` when the prompt has text, or a dialog, survey, band element or another pane holds the keys. The pane then opens without the keyboard. So:
- Every pane works fully by mouse: hotkeys are extras, never the only way.
- `$.ui.panes()` says whether our pane holds the keyboard. Hotkey hints show only when it does.

**After a reload,** `$.ui.panes()` finds our pane still open, so the arbiter rebuilds its slot state from it, not from memory.

**Close events:** `ui.close` says who closed the pane (`person`, `plugin` or `unload`). Only `person` blocks automatic reopens. For Blast Radius, `person` means Cancel.

**Two Switchboard panes at once never happen.** If another plugin's pane is in front, the app shows tabs; Switchboard only ever adds its one tab.

### 4.3 Above the prompt: one card plus one status row

The band has two parts:

```
┌ card slot (0 or 1 card)                                    ┐
└ status row: [agents progress] [replay hint]       [🔔 8 in Inbox] ┘
```

**Card slot**, highest first:

1. **Meeting starting.** Takes the keyboard and plays the alert sound.
2. **Blast Radius fallback.** Only when the pane can't open.
3. **Cache Tax hold.** Your own message is waiting.
4. **Needs you now.** At most one item, Critical level only.
5. **Reflect suggestion.** Only when idle (no turn running) and nothing above is waiting.

Rules for the card slot:
- A lower card waits in a queue and never shows on top of a higher one.
- Reflect suggestions expire after 30 minutes unseen; they stay in `/sb-reflect`.
- A needs-you card that you dismiss moves into the bell.
- When the app shows a survey (`hasSurvey`), we show nothing.
- Other plugins' band rows are kept: we draw ours, then `next(e)` below.

**Status row:**
- **Agents progress:** only while a flow runs.
- **Replay hint:** after a turn with edits, until the next prompt.
- **Bell chip:** always at the right when the Inbox feature is on. It shows the count of unread items; with 0 it shows a plain bell.
- If the row has nothing but a bell with 0, the whole band is omitted. Quiet means no band at all.

**Height budget:** card plus status row stay at 8 rows or fewer in the terminal. On desktop the card is at most 260 px tall; longer content gets "Show more".

### 4.4 Keyboard

Hotkeys only act while their surface holds the keys. They are unique within each surface:

| Surface | Keys |
|---|---|
| Blast Radius | `1` Delete/Run, `2` Cancel (focused) |
| Meeting card | `Enter` Join, `1` In 1 min, `3` In 3 min, `n` Not going |
| Cache Tax card | `1` Pay and send, `2` Start fresh, `3` Show status |
| Reflect card | `1` Save for project, `2` Save for all, `3` Reword, `4` Don't save |
| Needs-you card | `1` Open in Inbox, `2` Remind me, `3` Dismiss |
| Replay pane | `p` previous, `n` next, `c` close |
| Files pane | `/` search, `j`/`k` move, `h`/`l` fold, `Enter` select, `y` copy path |
| Status row | `0` opens the Inbox (the bell); a digit typed into an empty prompt presses band buttons, so only `0` is used there |

### 4.5 Commands

Every command starts with `sb-` (plus `/switchboard`), so none clash with yours or each other.

| Command | Arguments | Runs while a turn is going? (`immediate`) |
|---|---|---|
| `/switchboard` | none | yes |
| `/sb-files` | `[path]` | yes |
| `/sb-replay` | `[turn]` | yes |
| `/sb-blast` | `history`, `off 1h`, `on` | yes |
| `/sb-flow` | `<task>` | no (starts a turn) |
| `/sb-agents` | none | yes |
| `/sb-reflect` | `pause`, `resume` | yes |
| `/sb-cache` | `warm <6h, 90m, always>`, `off`, `guard warn` or `guard hold` | yes |
| `/sb-inbox` | none (opens, or offers "Make this the Inbox session") | yes |
| `/sb-auto` | `<person or source>: <what to do>` | Inbox session only |
| `/sb-pause` | `[1h]` | yes, in every session |
| `/sb-browser` | `<url>` | terminal only; hidden elsewhere |

Commands are hidden from the menu while their feature is off. Typing one then says "Files is off. Turn it on in /switchboard."

How hiding works (verified in the types): every command is registered once per session in `session.start`. There is no way to unregister one, so:
- a `command.describe` hook answers `isHidden: true` for a command whose feature is off;
- turning a feature on or off calls `$.ui.invalidate('command.describe')`, so the menu updates at once;
- `/sb-auto` is hidden outside the Inbox session, and `/sb-browser` everywhere except the terminal.

### 4.6 Notifications

- OS notifications only for Meeting and Critical items, and at most one per item.
- Within 10 s, a burst collapses into one: "5 new in Inbox".
- Focus mode and quiet hours (default 20:00–09:00) mute everything except meetings.
- No toast floods: at most 1 Switchboard toast on screen.

---

## 5. Architecture

### 5.1 Repository layout (fresh)

Work starts on a new branch `v2`. The current `main` code stays untouched until v2 reaches feature parity, then it is removed in one commit.

```
switchboard/
  .claude-plugin/plugin.json          # name, version, types, userConfig
  .claude-plugin/marketplace.json     # one-line install
  hooks/hooks.json                    # { "modules": ["./register.tsx"] }
  hooks/register.tsx                  # wires events to features; every $ call lives here or in feature files
  hooks/core/
    arbiter.ts                        # section 4: pane slot, card slot, status row, queue
    store.ts                          # typed $.store keys, migrations, size caps
    theme.ts                          # tokens dark/light, detection
    commands.ts                       # command table, enable/disable per feature
    session.ts                        # Inbox session id, session.send helpers
  hooks/ui/                           # pure render functions per surface
    kit/                              # Frame, Card, Eyebrow, Pill, Badge, Buttons, Bars, Ring, Crab, Tree rows
    svg/                              # picture builders (desktop)
    text/                             # terminal renderers
  hooks/features/
    files/  replay/  blast/  agents/  reflect/  cache/  inbox/  auto/  browser/  control/
  types/index.d.ts                    # PluginState contract ($.state keys)
  watcher/                            # Python: inbox sources only
    main.py  queue.py  rules.py  safety.py  cli.py
    adapters/ slack.py gmail.py calendar.py github.py jira.py
    auth/
  scripts/  bootstrap.sh  check-plugin.sh
  tests/
    hooks/*.test.tsx                  # claude plugin test, terminal + desktop
    py/                               # pytest with fixtures
  THIRD_PARTY_NOTICES.md
  docs/  BUILD_PLAN.md  DEVELOPING.md  SECURITY.md
```

One hooks module, `register.tsx`. If `claude plugin validate` on 2.1.295 still refuses `$` passed to helpers (a 2.1.280 rule, re-checked in P0-1), features export pure functions that take data and return trees or plans, and `register.tsx` makes every `$` call. Otherwise features may take `$`.

### 5.2 State

| Kind | Where | Example | Limit |
|---|---|---|---|
| Live UI values | `$.state` (session, redraws readers) | current pane, card queue, Files status, Replay index | declared in `types/index.d.ts` |
| Settings, small history | `$.store` (across sessions) | feature on/off, auto-open flags, keepwarm, last 3 replays | 4 MiB total; we cap at 1 MiB |
| Inbox items, rules, action log | SQLite in `~/.switchboard/` | queue, idempotency keys, undo info | auto-archive after 14 days |
| Secrets | OS keychain | Slack, Google, GitHub, Jira tokens | never in `$.store`, logs or prompts |

### 5.3 The Inbox session

**Making it.** `/sb-inbox` in a new session offers "Make this the Inbox session". Then:
1. Switchboard stores its `$.session.id()` as the Inbox session.
2. It sets the session title to "Inbox" (`classic.SessionStart` → `sessionTitle`).
3. It runs every model request of that session on Haiku 4.5. No setting needs to change:
   - a `turn.step` hook rewrites `model` (and `effort` to low) on each request, but only in the Inbox session;
   - an `agent.spawn` hook does the same for every subagent started there.
   - Verified in the 2.1.295 types: `turn.step` lets a hook rewrite `model` and `effort` going down. `$.config.set` has no model row, so it can't be used for this.
   - A rule that asks for a stronger model is the only exception. Its own step carries that model, and the hook lets it through.
4. It asks you to pin the session in the sidebar; a plugin can't pin it for you.

**What runs there:**
- the Inbox and Auto panes;
- inbox chat ("What needs me today?");
- drafting, and rule matching and actions.

**Model and cost:**
- All background calls use `$.model.complete({ model: 'haiku' })`, whatever the session's model.
- Auto tasks with tools run as subagents (`$.agent.spawn`) limited to Switchboard's inbox tools, also on Haiku.
- A rule may ask for a stronger model, for example Sonnet for PR reviews. The rule card then shows its cost.
- Today's cost shows in the Inbox status card.

**Other sessions:**
- They show the bell and needs-you cards from the shared queue.
- Their buttons send requests to the Inbox session with `$.session.send({ to: { sessionId }, text })`, for example "draft a reply to #12".
- The Inbox session catches these with a `session.receive` hook. It answers `{ consumed }`, so the request never reaches the model or the transcript and costs nothing; Switchboard's own code does the work.
- **What a hand-off may carry:** an item id plus one of `open`, `draft`, `remind` or `dismiss`. Nothing else is accepted.
  - Sends never travel this way. A send always needs a click in the Inbox session.
  - The types say `origin.plugin` is only the sender's claim, so we never trust it as a guard. Every request is re-checked against the queue: the item must exist, and the action must be allowed for it.
  - Any other text arriving there is passed on to the model untouched.
- Coding sessions never run inbox AI work.

**When the Inbox session isn't running:**
- The watcher keeps collecting. The bell and Critical notifications still work.
- Drafts and auto actions wait in the queue, marked "waiting for the Inbox session".
- "Open in Inbox" can't switch sessions for you (probe P0-7 for a deep link). It says "Open the Inbox session in the sidebar", and the item is waiting there when you do.

**More than one Inbox session:**
- Only the stored id is the Inbox.
- `/sb-inbox` in another session offers "Move the Inbox here", which hands over the role and releases the old one.

### 5.4 Inbox data flow

```
Slack (Socket Mode) ─┐
Gmail (connector or OAuth) ┤        ┌─► coding sessions: bell, needs-you card (read only)
Calendar (connector) ─┤─► watcher ─► SQLite queue ─┤
GitHub (API) ─────────┤   (Python)                 └─► Inbox session: panes, drafting, auto rules
Jira (connector or API) ┘
```

**Watcher process:**
- One watcher process across all windows (lock file).
- The first session that starts it owns it. Others follow the queue through the watcher CLI (`cli follow`).
- When the owner closes, the next session takes over.

**Connector sources (Gmail, Calendar, optionally Jira):**
- They can only be called from a running session (`$.mcp.call` uses Claude's sign-in).
- The Inbox session polls them under one lease with the safety governor; other sessions never call them.
- Without the Inbox session, those sources pause, and the bell shows "Gmail paused: open Inbox".
- The alternative is direct OAuth in the watcher, chosen per source in setup.

**Sending:**
- Every send goes through the watcher's guarded send path (`cli send`): recipient check, rule allow-list, daily cap, idempotency key, re-read of the thread, action log with undo info.
- Connector sends go through the Inbox session with the same checks run first through `cli send_plan`.

### 5.5 Drawing the design

**Desktop** (decided 2026-10-11 after the P0-2 probe; the method for every phase):
- Cards, rows, pills, bars, the countdown ring, buttons and switches are SVG pictures built from the tokens, exactly as the design draws them. They follow light and dark through CSS variables and `prefers-color-scheme`.
- **Every clickable part is a picture with a see-through Client over it** (`hooks/ui/hits.tsx`, `clickable()` in `hooks/ui/click.tsx`). The Client finds the part under the pointer and posts `{ hover }` and `{ press }`; the picture draws its own hover and pressed states. No app `Button` is laid under a picture any more: its hover box showed over the pictures.
- Simpler controls (text buttons in rows, chips) may be drawn inside a Client from Box and Text with background colors, as claude-code-filetree does. Hover there is instant, handled inside the Client.
- The app's own `Button` stays in the terminal and the other text surfaces, where it draws as `[ label ]` and takes hotkeys.
- Pointer positions arrive in whole cells (about 8 x 19 px); hit areas are padded to the control, and controls keep at least one cell apart.

**Terminal:** the same structure in text: box-drawn cards, block bars, hotkeys, colored text using theme keys.

**Theme:** follows Claude's theme.
- SVG: `prefers-color-scheme`.
- Text: Claude `ThemeKey` colors.
- `config.set` theme changes trigger a redraw.
- Reduced motion turns off the countdown and dither animation.

**Limits we design within:**
- SVG 131,072 chars per picture, so one picture per section.
- Tree 20,000 nodes and 100,000 chars.
- Lists cap at 300 rows with "Show more".

---

## 6. Phases

Each phase lists its scope, tasks, edge cases, tests and a gate. A phase is done only when its gate passes on the real desktop app, in both dark and light, and in the terminal.

### P0 · Foundations and probes

**Goal:** a skeleton plugin that loads on 2.1.295 desktop and 2.1.296 terminal. It shows the Switchboard pane with every feature switch, and answers the open questions before any feature is built.

**Tasks:**
1. Branch `v2`, the new layout, `plugin.json`, `marketplace.json`, `check-plugin.sh` (validates and tests against every Claude Code on the machine).
2. Tokens (dark and light), theme detection, UI kit components with picture and text versions.
3. Arbiter: the pane slot, card slot, status row and queue from section 4, with unit tests for every priority rule.
4. Store module with typed keys, size caps and migrations.
5. Command table: register `/switchboard` and every `/sb-*`, hidden while its feature is off.
6. Switchboard pane (screen 2): feature switches, statuses, commands, and "Changes apply right away".
7. A dev probe mod for the questions below. Each answer is recorded in `docs/DEVELOPING.md`.

**Probes (must answer before P1):**

| # | Question | Fallback if no |
|---|---|---|
| P0-1 | Does 2.1.295 still refuse helpers that take `$`? **Answered 2026-10-11:** yes across an import, no for a function declared at the top of the same file. A plugin also has exactly one hooks module (a second `modules` entry is refused). | Every `$` call in `register.tsx`, helpers at its top level; features stay pure |
| P0-2 | Does `Client` load and receive pointer and keys on desktop? **Answered 2026-10-11: yes** on 2.1.295: `enter`, `move`, `leave`, `down`, `up` in whole cells (`fine` is null). A Client's region is the size of what it draws. Custom buttons A1, A2 and B all worked in the probe. | (not needed) |
| P0-3 | Does `$.ui.open({columns})` set desktop pane width? | Default width; layout adapts down to 360 px |
| P0-4 | Do SVG pictures follow the app's light/dark switch live? | Redraw on `config.set` theme with explicit colors |
| P0-5 | How tall can the band card be on desktop before it scrolls? | Shorter card, "Show more" |
| P0-6 | Does the `turn.step` model rewrite show as Haiku in the desktop's cost and model labels? (The rewrite itself is verified in the types.) | Show our own "Haiku 4.5" label and today's cost from `$.session.usage()` |
| P0-7 | Is there a link that opens another desktop session? | A "Open the Inbox session in the sidebar" hint |
| P0-8 | Does `$.session.send({to:{sessionId}})` reach a session in another desktop window, and does its `session.receive` hook consume it without asking you? | Hand off through the shared queue instead and let the Inbox session poll it |
| P0-9 | Does a band card hold the keyboard for the meeting (focus + hotkeys)? | Open the meeting as a focused pane instead |
| P0-10 | Can `Button` take the clay primary look (`variant="primary"`) on desktop? | Clay picture with a blank Button under it |
| P0-11 | Does a `Box` with `borderStyle="round"` and a clay `borderColor` draw the framed look on desktop? (The pane's own edge is the app's.) | Frame drawn inside each picture |
| P0-12 | Does `$.ui.notify` reach the desktop app? **Answered: no**, `{ isSent: false, reason: 'no-surface' }`. | macOS notification through `osascript`, text passed as an argument (as v1) |

**Edge cases:**
- Plugin loads while a turn is running.
- Hot reload fires `session.start` again, so state is restored from `$.store`.
- `/clear` raises `session.end` without a new `session.start`, so we handle `classic.SessionStart {source:'clear'}`.
- Two windows open.
- Mobile and VS Code surfaces get the text fallback.
- A feature throws, so the hook `.catch` keeps the rest working.

**Tests:**
- Arbiter priority table.
- Command hiding.
- Theme switching.
- Every render on `terminal` and `desktop` in `claude plugin test`.

**Gate:** the Switchboard pane matches screen 2 (dark and light) on desktop. All probes are answered and recorded. `check-plugin.sh` passes on both versions.

---

### P1 · Files

**Goal:** screens F2 and F3.

**Detecting what Claude does** (ported from filetree, MIT):
- **Reads.**
  - `tool.call` for Read, Grep and Glob, after `next`; Grep and Glob are new, filetree skips them.
  - Bash reads come from our port of filetree's command parser (filetree git.ts:182-261). The Bash result in 2.1.295 carries no list of files read, so the parser is the only source.
- **Writes.**
  - Edit, Write and NotebookEdit from the tool input and result.
  - Bash writes use `bashEditDiff.files` (or `changedFiles`, up to 200 paths) when the result has it. Otherwise a `find -newer` mark (filetree register.tsx:355-366, 668-735).
  - `bashEditDiff` is marked `@internal` in the types and may change. The `find -newer` fallback is tested on its own, so Files keeps working if it goes away.
- **Pushes and PRs:** `gitOperation.push` and `gitOperation.pr` show in the footer: "● pushed to `main`" or "● PR #482 created".
- **Background Bash:** results wait for the task notification.
- **Commits** need proof: `gitOperation.commit.sha`, or HEAD moved. The committed files come from `git diff-tree`.
- **Live git:** `classic.SessionStart → watchPaths` for `.git/index` and `.git/HEAD`, then `classic.FileChanged` triggers a sync after 300 ms.

**The status card:**

| State | Card | When |
|---|---|---|
| Idle | No card. Branch row only | Before any read |
| RIGHT NOW (teal) | "Claude is reading `<file>`, in `<folder>`" | During a read |
| RIGHT NOW (orange) | "Claude is editing `<file>`" | During an edit |
| DONE (orange) | "Claude edited N files", with the paths | After the turn ends |

- **Branch row:**
  - "clean, nothing changed", or "+a −d · N changed", or "+a −d · committed `sha`";
  - "not a git folder" outside git (the legend then drops "Not committed").
- **Claude touched:** files with type badge, folder, +/− and a pill: Reading, Opened, Edited or committed.
- **All files:** the tree.
  - Teal row while reading, green row when committed, times on the right.
  - Search reaches into closed folders (`git ls-files`, 60 matches).
  - Collapse all, Up a folder, Back to project (when away), Show sizes (only for rows on screen), Hide hidden. Refresh was dropped (2026-10-11, your call): git and folders refresh on their own.
  - "Find a file" is the app's own text field (`Input`) under the toolbar; matches are a picture with see-through Clients, and a match opens its folders and scrolls to it.
- **Auto-open:** `/sb-files auto on|off` (off by default).
- **Footer:** "● committed `sha`".

**Edge cases:**

| Case | Handling |
|---|---|
| Huge repos (100k files) | `--ignored=no`; cap kept nodes; lazy folders; 300 rows per picture; "Show more" |
| Not a git folder | Tree from `find -maxdepth 6`; no git row |
| Files outside the project | In "Claude touched" with the full path; never in the tree |
| Renames | Show the new name, "renamed from old" |
| Binary files and files over 4 MiB | No preview; "too large" |
| Symlinks | Follow for stat; don't walk linked folders for sizes |
| Subagent reads and edits | Tagged "by agent `<name>`" |
| Denied or failed tool calls | Revert the card; not counted |
| Two windows on one project | Each reads git; staggered refresh |
| cwd changes | `classic.CwdChanged` follows, unless you pinned a folder with `/sb-files <path>` |
| Worktrees and submodules | Resolve `gitdir:` files |
| Windows paths | Drive paths normalized |
| `/clear`, resume, fork | Rebuild the tree; "Claude touched" resets |

**Pane rules:**
- Opens on `/sb-files`, or automatically during work if that setting is on (off by default).
- Closes 20 s after the turn when it opened automatically and you didn't touch it.

**Tests:**
- Porcelain and numstat parsing fixtures, including rename, detached HEAD and no commits.
- Read and write detection from recorded tool results.
- The full card state machine.

**Gate:** on a real repo, ask Claude to change a value, update its test and commit. The pane goes through RIGHT NOW → DONE → committed and matches F2 and F3 in both themes.

---

### P2 · Replay

**Goal:** screen F4.

**Recording** (ported from replay-theater, Apache-2.0, improved):
- Record after `next`, using the tool's own record: `originalFile`, `structuredPatch` and `gitDiff`.
- Skip calls that were denied, errored or staged.
- NotebookEdit uses its cell sources.
- Bash edits use `bashEditDiff`; otherwise `git stash create` before and `git diff <sha>` after (it changes no refs).
- Steps are grouped per main-loop turn, ordered by completion. Subagent edits are tagged.

**Diff:**
- Line diff: Myers, with the common start and end trimmed first.
- Word level:
  - pair `-` and `+` lines;
  - diff their tokens;
  - mark the changed words;
  - below 40% overlap, show whole lines instead.
- Legend: Removed, Added, Changed word, Unchanged.

**Screen:** "N edits in M files", "+a lines added, −d removed", "THE EDITS, IN ORDER" timeline, "EDIT k OF N", the file and its folder, the diff, Previous edit and Next edit.

**Showing it:** only with `/sb-replay` (your call, 2026-10-12: no hint above the prompt, no button on the Files DONE card).
- It never opens by itself.

**Storage:** the last 3 turns in `$.store`. Lines are cut to 500 chars, about 1 MiB in total, so Replay survives reloads and resume.

**Edge cases:**

| Case | Handling |
|---|---|
| Large files | Cap at 60 diff lines per step and 300 chars per line, with "Show full diff" |
| Edits that arrive after the turn (background agents) | Appended to that turn as "after the turn" |
| A new turn while Replay is open | Keep the open one and show "new edits ready" |
| "You changed this before accepting" | The `userModified` flag adds a note |
| Created or deleted files | Show as all added or all removed |
| Binary files | "Binary file changed" |

**Built (2026-10-11):** `hooks/features/replay/` (diff, model, pictures, view). Keys p, n and c reach the desktop pane through the hits Client once it is clicked; the terminal uses Button hotkeys. The status row hint is a picture with a Client, and the Files DONE card has a Replay button. `/sb-replay [turn]` picks one of the last 3 turns, as do Earlier and Later in the pane.

**Gate:** rename a function across 4 files. Replay matches F4, steps with `p` and `n`, and survives a reload.

---

### P3 · Blast Radius

**Goal:** screen F5.

**Hold:**
- `tool.call {tool:'Bash'}` classifies the command; the classifier is ported from blast-radius.
- Adds `find -delete`/`-exec rm`, `xargs rm` and `bash -c "<inner>"` (the inner command is classified again), `timeout N` and `doas`.
- When risky:
  1. measure;
  2. take the pane slot with `focus`;
  3. wait with a `$.process.run(['sleep','0.25'])` loop (see the budget rules below);
  4. on Proceed return `next(e)`; on Cancel return `{deny}` with "do not retry unless asked".
- One hold at a time. Others queue with "1 more held".

**Hook budget: the trap, verified in the 2.1.295 types (`HookBudget`).**
- A hook has 10 s of its own time. Time inside `$` calls and `next(e)` doesn't count, but two kinds of waiting do:
  - `$.clock.sleep`;
  - awaiting a plain promise, such as one a button resolves.
- **When a hook overruns, its `.catch` is asked. With no `.catch`, the engine runs `next(e)` for it, which means the risky command would run.** So:
  - the wait loop uses only `$.process.run(['sleep','0.25'])`, which is free time. The button handler sets an atom, and the loop reads it after each sleep;
  - the `.catch` returns `{ deny }` straight away, with no slow work, because it has only 1 s of grace;
  - the loop stops and refuses when `next.signal` aborts (you pressed Esc on the turn);
  - a unit test runs the hook with a fake clock past 10 s and checks the result is a deny.
- Measuring runs inside `$.process.run` too, so it is free. Its own 15 s timeout still applies.

**Measuring**, one argv-safe script with a 15 s timeout:
- total files and bytes;
- per folder: count and bytes (top 20);
- the 50 largest files;
- tracked vs untracked (`git ls-files`), so the line "None of these are tracked by git, so they can't be restored" shows only when that is true.

**Command types:**

| Command | Shown as |
|---|---|
| `rm` | "will delete N files · size" |
| `git clean` | the dry-run list |
| `git reset --hard`, `checkout .` | dirty files with line counts |
| Force push | the remote commits you'd lose |
| Migrations | pending migrations from each tool's status command |

**After you decide:**
- **Delete:** the files you can see get struck through as they go.
- **Cancel:** the pane closes at once.
- Otherwise the pane closes 3 s after the decision and the previous content comes back.

**Edge cases:**

| Case | Handling |
|---|---|
| Variables or subshells in targets (`$DIR`, `$(…)`) | "uses a variable, can't measure"; still held |
| 100k files | Counts only; "at least N files" if time runs out |
| You close the pane or press Esc | Cancel, not a 10-minute wait |
| Esc on the turn (abort) | Refused |
| No answer in 10 minutes | Refused |
| Pane can't open (narrow terminal) | Card slot fallback, priority 2 |
| Subagent commands | "from agent `<name>`", queued |
| Permission prompt after Proceed | Normal, shown by the app |
| Refused after Proceed | "didn't run", no strikethrough |
| Windows (no bash, sleep or du) | The Python helper sleeps and measures |
| `/sb-blast off 1h` | Pauses holds and logs it |

**Built (2026-10-11):** `hooks/features/blast/` (classify, measure, model, pictures, view). A command whose measure changes nothing (no matching paths, no dirty files, no dropped commits) runs without a hold. The hold loop reads decisions from a module map, since a waiting hook doesn't see `$.state` written meanwhile (DEVELOPING.md).

**Changed 2026-10-12 (your call):** a held command waits 1 minute, then runs by itself; `/sb-blast wait 30s|5m|1h|none` changes that (none waits until you choose). The pane and a row above the prompt show "Runs by itself in 0:42". While held, the row above the prompt always shows with its own Delete/Cancel (keys 1 and 2) and a toast says where to answer, so a hidden side pane can't leave Claude stuck.

**Gate:** `rm -rf build` with 9 files matches F5. Cancel refuses, and Delete removes and strikes through. A force push and a `git reset --hard` are held with the right numbers.

---

### P4 · Agents

> **Changed 2026-10-12 (your call): display only.** Agents runs no model and starts nothing: no `/sb-flow`, no tier agent files, no `progress`/`step` tools. It watches the subagents Claude runs (`agent.spawn`, `turn.step`, `turn.complete`, `$.agent.list()`) and draws them as F1. Runs started in one turn are a group titled from that turn's prompt; the band bar is the group's finished share ("3/4 done"); each run's crab and color come from the model and effort it ran with (Fable astronaut, xhigh detective, high hard hat, medium chef, Haiku or low racer, Explore pirate). Prices are in `hooks/core/prices.ts`, checked against the API price list on 2026-10-12. The sections below are kept for the record; where they mention flows, tiers or the two tools, this note wins.

**Goal:** screen F1, `/sb-flow` and `/sb-agents`.

**Ported from** claude-kit savvy-progress and savvy-flow, MIT, "Copyright (c) 2026 johnnyvizz". We port the tracking logic and the flow prompt. The drawing is ours; savvy's tier colors include a purple, which we don't use.

**`/sb-flow <task>`:**
- Starts a turn with Switchboard's flow instructions, adapted from savvy-flow's SKILL.md. The phases:
  1. **Plan:** the main conversation only.
  2. **Design:** never delegated.
  3. **Delegate:** independent tasks start in parallel in one message.
  4. **Review:** every worker report is treated as a claim and checked. At most 2 rounds of sending work back.
  5. **Close.**
- Five tiers ship as agent files under `agents/`, each with fixed `model:` and `effort:` frontmatter:

  | Tier | Model / effort | Crab |
  |---|---|---|
  | fable | Fable 5.1 / high | astronaut |
  | heavy | Opus 5.5 / xhigh | detective |
  | careful | Opus 5.5 / high | hard hat |
  | medium | Opus 5.5 / medium | chef |
  | light | Haiku 4.5 / low (savvy uses Opus low; Haiku is cheaper and is our default) | racer |
  | other | anything else (Explore shows a pirate) | plain |

  The orchestrator picks the cheapest tier that gets the task right the first time. When unsure between two, it takes the higher one, except Fable.
- **Two in-process tools** are registered with `$.tool.register` in `session.start` and answered by `tool.call` hooks. The model sees them as `mcp__switchboard__progress` and `mcp__switchboard__step`, so the agent files must name exactly those.
  - **`progress`**, for the orchestrator:
    - fields: `title`, `total`, `done`, `phase` (plan, design, delegate, review or close), `finished`, and `tasks[]` of `{ title, tier, after[] }`;
    - fields left out keep their value;
    - a new title, or a finished flow, starts a new flow.
  - **`step`**, for workers: `done`, `total` (1 or more) and `note`.
    - It is matched to the run by `e.agentId`; a call without one is ignored.
    - Workers call it after reading their brief, 3 to 8 steps in all.
  - **Linking plan to runs:** a task's `title` must equal the Agent call's `description`. Both are normalized (case, spaces, punctuation) before matching.

**Tracking:**
- **`agent.spawn`:** call `next(e)` first, then:
  - skip the run if the result is a deny;
  - otherwise add a run with `id = agentId`, the resolved `model`, and `parentAgentId` for nesting;
  - count `round` = 1 + earlier runs with the same description, so retries show as "round 2";
  - cap the list at 200.
  - Its `.catch` passes the spawn through. Agents is display only and must never block a subagent.
- **`turn.step`** (a generator, `yield* next(e)`), for steps with an `agentId`:
  - context = input + cache read + cache creation + output of the latest step;
  - tokens and cost add up over steps;
  - `model` and `effort` come from the step itself, so the tier shows what actually ran.
- **`turn.complete`:** the reason gives the end state:
  - `answer` → done;
  - `aborted` → stopped;
  - `refusal` or `error` → failed, with the reason.
  
  savvy treats everything that isn't an answer as "failed"; we keep the four apart. A run with no steps seen takes the turn's own usage.
- **`$.agent.list()`** on `session.start`, after a reload or resume, and after compaction. It rebuilds runs from `{ id, status, parentId, spawnedBy }`. savvy never does this.
- **Clock:** one `$.clock.every(1000)` ticks the time atom, only while something runs.

**Numbers:**
- **Context %:** for the main thread, from `$.session.usage().context` (`window`, `percent`). For subagents, tokens ÷ the model's window: 200k for Haiku, 1M for others (savvy's table). This is "≈".
- **Totals:** session cost comes from `$.session.usage().cost`, the same figure as `/cost`, so the tiles always agree with `/cost`.
- **Per-agent cost:** "≈" from step usage × a price table.
  - The two repos' tables disagree (Opus 5.5 input $4 vs $5; Fable cache read $0.25 vs $1). So the table is checked against the current Claude API price list in P4 task 1, and kept in one file (`core/prices.ts`) shared with Cache Tax.
  - An unknown model shows "?".

**Screen:**
- Cost, Tokens and Time tiles.
- Running, Finished and Planned sections. A row shows its crab, steps, context %, tokens, cost, time and a bar:
  - with steps reported, the bar is step progress in the tier color;
  - without, it is context %, in grey.
- **Band row** (desktop: one SVG, because sibling elements wrap):
  - a dot, the title (at most 40% of the width), the dithered bar with a phase pill, %, a crab;
  - then two real Buttons: `×N` toggles the pane, ✕ (`role="dismiss"`) hides the row for this flow.
  - The terminal version uses `█░` text.
- **Dither:** fixed noise on 3 px cells, denser toward the filled end. A faint second layer shows tasks that were handed out but not started, with a tick per task. Twinkle is CSS, and off under reduced motion.

**Edge cases:**

| Case | Handling |
|---|---|
| Plain Agent calls without a flow | Tracked anyway; the pane opens by itself only if 2+ run together |
| Nested agents | Under their parent via `parentAgentId` (savvy ignores it) |
| Teammates (`teammateId` on the spawn result) | Listed with "teammate" |
| Retry of the same task | One row, "round 2" |
| Agent stopped / refused / errored | Grey "stopped" / red "failed: refused" / red "failed: error" |
| Spawn denied by another plugin | Not listed |
| Compaction or resume mid-flow | Rebuilt from `$.agent.list()` |
| Reload mid-flow | Atoms survive; module variables rebuilt in `session.start` |
| Unknown model price | Cost "?"; totals still exact from `/cost` |
| More than 8 agents | Finished ones grouped |
| Claude never calls `progress` | Rows still show from tracking; the band shows the count, not % |
| A worker calls `step` from the main thread | Ignored |
| ✕ on the band row | Hides the row for this flow only |
| Hidden band, flow still running | `×N` in the status row reopens it |

**Gate:** `/sb-flow` with 3 agents and a reviewer matches F1 live. The tiles equal `/cost`, a stopped agent shows "stopped", and a reload mid-flow keeps every row.

---

### P5 · Reflect

**Goal:** screen F6.

**Ported from** claude-reflect's mod (`mod/`, v3.3.0), MIT, "Copyright (c) 2025 Bayram Annakov".

**Capture.** The `prompt.submit` hook does only cheap checks, then puts the text on a queue (at most 20). The work runs later through `$.clock.after(0, drain)`, so typing is never slowed. A message is a candidate only when all of these hold:
- you typed it: `e.origin.kind` is `composer` or `bridge`. Plugins, SDK, peers and schedules are skipped. This also means hand-offs to the Inbox session can never become rules;
- it isn't a slash command;
- it isn't trivial. The list covers "ok", "yes", "continue", "lgtm", bare numbers and their equivalents in other languages;
- it is 500 characters or less;
- it doesn't look like a secret: key prefixes (`sk-`, `ghp_`, `xox`, `glpat-`, `AKIA`, `AIza`), JWTs, any run of 32+ letters and digits, `password|token|api key = …`, or PEM blocks;
- Reflect isn't paused (`/sb-reflect pause`).

`remember: <rule>` skips the model. It becomes a suggestion with confidence 1, and its scope is all projects unless you say "this project".

**Check:**
- **First pass:** `$.model.classify(text, ['correction', 'other'], { model: 'haiku' })`. This is our addition: cheap, and most messages stop here.
- **Only for `correction`:** one `$.model.complete({ model: 'haiku', maxTokens: 300, timeoutMs: 30000 })`.
  - The system prompt (adapted from reflect's) says everything after it is data. It asks whether the message states a reusable rule, as opposed to a one-off redirect, question or approval.
  - The rule is one imperative line of 25 words or fewer. Scope is `project` only when the rule is about this repo.
  - The user prompt holds three tagged parts: the project folder, the last 1,200 characters of Claude's last reply (from `$.session.messages()`, marked untrusted), and your message. Closing tags inside the text are stripped, so the text can't break out.
- **Answer:** `{ is_rule, rule, scope, confidence }`. The first `{…}` is parsed, and scope and range are checked.
- **Kept** when confidence ≥ 0.7. The rule is cleaned: 200 characters at most, one line, no control characters, no `<!--` or `-->`, no secret-shaped text.

**Repeats:**
- Similarity is Jaccard over ordered word pairs. Because the pairs are ordered, "pnpm not npm" and "npm not pnpm" don't match, which is correct.
- ≥ 0.6 against a stored suggestion: count it up (×N) instead of adding a new one.
- ≥ 0.6 against a bullet already in the target CLAUDE.md: stored as saved and never shown.
- Store: `$.store` key `reflect.items`, capped at 300. Decided items are dropped oldest-first, before pending ones.
- Expiry: a pending suggestion leaves the band after 30 minutes unseen but stays in `/sb-reflect`. Suggestions untouched for 90 days are dropped; reflect's mod has no expiry, but its older version used 90 days.

**Card:**
- "SAVE THIS AS A RULE?", "95% sure", the rule, ×N, "From what you said".
- Where it goes: this project (`<session root>/CLAUDE.md`) or all projects (`$HOME/.claude/CLAUDE.md`). The suggested scope's button is the primary one.
- Buttons: Save for this project, Save for all, Reword, Don't save.
- One card at a time through the arbiter, shown only when idle. reflect shows two rows at any time; the screen design asks for one quiet card. "+N more · /sb-reflect" when more are waiting.
- **Reword:** an Input prefilled with the rule, then Save. reflect's trick of filling the prompt with `remember:` is kept as a fallback for surfaces without Input.

**Save:**
- Markers: `<!-- switchboard: learned rules (edit freely) -->`, `## Learned rules`, `- rule` bullets, `<!-- end switchboard -->`.
- Re-read the file just before writing.
  - If a bullet anywhere in the file is ≥ 0.8 similar, leave the file unchanged.
  - No markers: append a new section.
  - Broken markers (only one, repeated, or end before start): write nothing. A toast says which line to fix.
- **Writes across sessions are locked.** A lock file in `~/.switchboard/locks/` with a 5 s stale timeout, plus the in-session promise chain. reflect's README admits two sessions can lose a bullet; we close that gap.
- The write itself is atomic: a temp file in the same folder, then rename. File mode is kept.
- After saving, a `prompt.compose` section (`switchboard:rules`, scope `session`) applies the rule in this session at once.

**Privacy:** your message is never stored, only the extracted rule.

**Edge cases:**

| Case | Handling |
|---|---|
| claude-reflect is installed too | `$.command.list()` finds `/reflect-queue`. Reflect starts off and the Switchboard pane says "claude-reflect is installed; use one" |
| Two sessions save at once | Lock file; the second waits, then re-reads |
| CLAUDE.md missing | Created with the markers |
| Read-only file or folder | Toast with the path; the suggestion stays pending |
| CLAUDE.md is a symlink | Write through to the target |
| Non-English corrections | Detected in any language; the rule is written in the language you used |
| Card would show during a turn | Never; it waits for idle |
| Survey showing (`hasSurvey`) | Nothing shown |
| Don't save 3 times on similar rules | Stops suggesting that rule |
| Model timeout or bad JSON | Dropped quietly; one debug log line |
| Message with a secret | Never sent to the model |
| `/clear` | Pending suggestions stay; they are per project, not per session |

**Built (2026-10-12):** `hooks/features/reflect/` (rules, model, pictures, view). There is no `$.session.messages()` in 2.1.295, so Claude's last answer comes from `turn.complete`'s `answer` (kept in memory only). There is no `$.fs.rename`, so the atomic write is `$.fs.write` to a temp file plus a `mv` script that keeps the mode and follows a symlink; the cross-session lock is a `mkdir` lock folder in `~/.switchboard/locks`, stale after 5 s. Capture shares the one catch-all `prompt.submit` hook with Files.

**Card height (2026-10-12):** the desktop band shows about 12 rows (`maxRows`), less than the full F6 card plus its buttons, so it scrolled and the buttons were cut off. When the full card doesn't fit `maxRows × ROW_PX`, the band draws `compactSvg`: one picture with the buttons inside it, about 180 px tall. The user chose this picture card over a row built from the app's own Text and Buttons; Inbox alerts follow the same style.

**Gate:** say "no, use pnpm not npm" twice. The card matches F6 with ×2, and Save writes the project CLAUDE.md correctly. Run two sessions saving at the same moment: both bullets are kept.

---

### P6 · Cache Tax

**Goal:** screen F7 and `/sb-cache`.

**Ported from** karanb192/cache-tax, MIT, "Copyright (c) 2026 Karan Bansal".

**Knowing when the cache is cold:**
- `lastRequestAt` is updated by:
  - `turn.step` on the main thread (no `agentId`);
  - `turn.complete`, as a floor;
  - each warm ping;
  - on resume, `classic.SessionStart`, which gives `seconds_since_last_response`, `context_tokens`, `prompt_cache_likely_expired` and `estimated_cache_write_usd`.
- **TTL** (cache-tax always assumes 1 hour; we learn it):
  1. `cache_ttl` (`5m` or `1h`) from `classic.PreModelSwitch`/`PostModelSwitch` when the model changes;
  2. otherwise, observed: a turn after a gap between 5 and 60 minutes that rewrote most of the context proves 5m, and one that read from cache proves 1h. The answer is stored per model;
  3. default 1 hour until known. A wrong guess only means a missed hold, never a wrong one.
- **Cold** = `lastRequestAt > 0`, not just compacted, and `now − lastRequestAt ≥ TTL`.
- **Context size:** `$.session.usage().context.tokens`; fallback: the last turn's input + cache read + cache creation.

**Cost math:**
- **Cold send:** `estimated_cache_write_usd` when the engine gives it (resume, model switch). It uses the managed price when set, so it's the most accurate figure.
- **Otherwise:** context × cache-write rate. A warm turn is context × cache-read rate.
- **Ping cost:** read × r + creation × w + input × base + output × o.
- **Break-even:** floor(w ÷ r) pings cost the same as one cold write. The card says "keeping it warm for 3 hours costs about N pings ≈ $x".
- **Prices:** `core/prices.ts`, shared with Agents and checked against the current price list (see P4). Unknown model: tokens only.

**Guard** (`prompt.submit`):
- Skips:
  - plugin-sent prompts (`origin.kind === 'plugin'`);
  - slash commands;
  - non-text prompts;
  - a warm cache;
  - context under 50,000 tokens.
- **Hold** (the default, `guard hold`): return `{ drop }` with the amber notice line, and keep the text as `held`. The card shows:
  - "Send it now" with the cold cost;
  - "A warm turn" with its cost;
  - "On hold: '…'";
  - the keepwarm offer.
- **Bypass:** sending the same message again goes through. cache-tax does this with an acknowledgement mark tied to `lastRequestAt`; we keep that, so the second Enter always works even if a button fails.
- `guard warn`: show the price in the status row, don't hold.
- **Learning from a miss:** in `turn.complete`, if the previous context was over 20k and this turn wrote at least half of it again, it was a cold write. It is logged, and keepwarm offers to arm for 3 hours.

**Card buttons:**
- **Pay and send:** `$.prompt.submit` with the held text and a one-time bypass mark. If keepwarm was offered, it is armed.
- **Start fresh:** offers `/clear`, then `$.prompt.fill` puts your held message back with a short summary note.
- **Show cache status:** prints the `/sb-cache` card in the chat.

**Keepwarm:**
- **Ping:** `$.model.fork({ prompt: 'Reply with the single word: warm' })`, about 50 minutes after the last request (5m TTL: 4 minutes), within the window you set:
  - `/sb-cache warm 6h` (the default window), `90m`, `always` or `off`;
  - a custom period must be at least 1 minute.
- **Scheduling:** `$.clock.after(min(deadline − now, untilCold, max(1 s, last + every − now)))`.
- **Warm check:** cache read > 0 and creation < 10% of read.
- **Stops**, saying why, when:
  - the deadline passes;
  - a ping finds the cache already cold;
  - the fork throws or `isAnswered` is false (nothing to fork, API error, aborted, empty reply);
  - you run `/sb-cache warm off` or `/clear`.
- **Compaction** resets the cache state, and keepwarm waits until the next turn.
- **Store keys:** `cache.deadline:<sessionId>` and `cache.every:<sessionId>` are per session; `cache.guard` and `cache.always` are global.
- `model.fork` always returns a result (verified), so cache-tax's null branch isn't ported.

**Edge cases:**

| Case | Handling |
|---|---|
| cache-tax installed too | `$.command.list()` finds `/keepwarm`. Cache Tax starts off and says so |
| Unknown model price | Show tokens only |
| Model switched since the last turn | Use the switch hook's `estimated_cache_write_usd`; recompute |
| Resume of an old session | `prompt_cache_likely_expired` marks it cold at once |
| Compaction | Context changes; recompute; keepwarm waits |
| You send twice quickly | The second send goes through (bypass) |
| Laptop sleeps | On wake, a gap longer than the TTL stops keepwarm with "the cache went cold while asleep" |
| API error on a ping | Stop keepwarm; never retry in a loop |
| Rate limited (`$.session.usage().rateLimits` near the limit) | Keepwarm pauses itself; the guard still works |
| Subagent turns | Don't touch `lastRequestAt` (main thread only) |
| Inbox session | Guard off there: Haiku context is small and cheap |
| `guard warn` | Show the price, don't hold |

**Built (2026-10-12):** `hooks/features/cache/` (model, pictures, view). Notes:
- The guard sits first in the one catch-all `prompt.submit` hook; a held message never reaches Reflect, and Pay and send queues it for Reflect itself. Pay and send uses `$.prompt.submit({ text, asUser: true })`, so the model reads your words bare.
- Card actions run in their own dispatch (`$.clock.after(1, …)`): work a press starts is dropped when the press ends.
- A message with a pasted image or file isn't held (the card can't send the attachment again); it goes through with its price in the transcript, like `guard warn`.
- `turn.step` only stamps requests while a main turn runs, so a keep-warm fork while idle never opens a turn.
- Start fresh runs `/clear`, then puts your message back in the prompt box with the first 300 characters of Claude's last answer as a "where we were" note. That avoids a model call, which would itself pay the cold write.
- `classic.SessionStart` stays one catch-all hook: git watching and Cache Tax's resume and `/clear` handling share it.
- The Inbox-session exception waits for P7, which has no Inbox session yet.

**Gate:** after more than an hour idle, a message is held and the card matches F7. Pay and send sends it exactly once, and keepwarm then reports warm pings. A resumed old session is held on its first message, with the engine's own cost figure.

---

### P7 · Inbox core: session, Slack and Gmail

**Goal:** screens 1, 3 and 4.

**Tasks:**
1. Inbox session setup (5.3): `/sb-inbox`, session id, title, Haiku, the pin hint.
2. **Watcher:**
   - SQLite queue with de-dup by id, edits updating in place, 14-day archive.
   - Alert levels from `priorities.yaml`: Critical, High, Normal or Quiet.
   - The safety governor: per-source caps, backoff, a 30-minute pause after repeated slow-downs, and a stop on rejected credentials.
3. **Slack:** Socket Mode for DMs, mentions and your threads; skip bots and your own messages; reconnect with backoff; backfill since the last timestamp.
4. **Gmail:**
   - connector polling from the Inbox session (default);
   - or direct OAuth with `users.watch`, a Pub/Sub pull subscription and `history.list`, renewed daily;
   - excluded labels never reach Claude.
5. **Bell and needs-you (screen 1):**
   - the bell count in every session;
   - one needs-you card for Critical items: Open in Inbox, Remind me in 1 hour, Dismiss.
6. **Inbox pane (screen 3):**
   - a status card (needs you, new today, sources live, today's cost);
   - search, source filters, Needs you, Everything else.
7. **Reply (screen 4):**
   - the message as a clean preview (HTML to Markdown in the watcher, remote images stripped);
   - a draft from Haiku for Short, Detailed or Ask a question;
   - Send, Edit, Ask Claude, Skip;
   - Undo for 10 s;
   - every send through the guarded path.

**Edge cases** (from v1's table, all kept, plus):

| Case | Handling |
|---|---|
| Inbox session closed | Collect only; Gmail connector paused; bell says so |
| A second window | Follows the queue; no second watcher |
| Token expired or revoked | "Reconnect Slack" card in the Inbox pane |
| 50+ messages at once | One summary, no flood |
| Thread edited or deleted before Send | Warn; re-read the thread |
| Reply all vs reply | Default Reply; explicit choice |
| Long threads | Last 10 messages plus a summary |
| Non-English | Draft in the sender's language |
| Text that tries to instruct the AI | Treated as data; fenced in prompts |
| Slack 429 | Retry-After, retry once |
| Over 40,000 chars | Block, offer to shorten |
| Laptop sleep or Wi-Fi drop | Backfill on reconnect |
| Two people with the same name | Picker with email |
| Sensitive labels | Never sent to Claude |

**Progress (2026-10-12), not yet committed:**
- **Your choice:** Gmail and Slack both go through Claude's connectors (MCP), polled from the Inbox session. The direct Slack app and direct Google sign-in stay available for later. The connector code waits until both connectors are on, so their tool names and fields can be read from a live session.
- **Built:** `hooks/features/inbox/` (model, drafts, pictures, view):
  - `/sb-inbox here` makes this the Inbox session. It runs every request (subagents too) on `claude-haiku-5-5` at low effort through `turn.step` and `agent.spawn`, and takes the title "Inbox" from `classic.UserPromptSubmit`'s `sessionTitle` with your next message.
  - `/sb-inbox demo on|off` and `/sb-inbox restart` control the watcher.
  - Every window spawns `watcher.main --stream`. The lock makes the first one watch and the rest follow (tail).
  - New items are told in one toast, or one summary when several arrive together, 1.5 s after the first.
  - Coding sessions get the needs-you card (Open in Inbox, Remind me in 1 hour, Dismiss) and the bell. The Inbox session gets the pane (screen 3) and the reply card (screen 4).
  - The reply card drafts Short, Detailed and Ask with Haiku, fenced. You can Edit, Ask Claude (fills the prompt box) or Skip. Send waits 10 s for Undo, then goes through `cli send` (the guarded path). A Slack send can be deleted afterwards.
  - The full reply card is too tall for a 12-row band, so a compact version is drawn when needed.
- **Watcher:** `watcher/markdown.py` turns HTML-only mail into a Markdown preview. Remote images are dropped (their alt text stays), unsafe links lose their address, and scripts and styles are removed.

**Phases 8 and 9, built 2026-10-12, not yet checked live (uncommitted):**
- `watcher/connectors.py`: Calendar events, GitHub notifications and Jira issues → items, with fixtures in `tests/test_connectors.py`. `cli ingest` accepts `calendar`, `github` and `jira`.
- `hooks/features/meeting/model.ts`: the lead time (5 min default), then 1 min, then the start; declined and past meetings never fire; two at one time share a card; Join only for https.
- `register.tsx`: the Inbox session polls Calendar, GitHub and Jira through the connectors every 60 s. Every window runs the 15 s meeting timer and shows the card in the band (text, with Join now, Remind me in 1 min and Not going).
- **Not built yet:** the connector tool names are matched by pattern (`calendar`, `github`, `jira` in the server name) and are unverified. The meeting card has no picture design, no sound, no OS notification and no keyboard takeover. GitHub and Jira actions (comment, approve, transition) and replies to them aren't built. Jira's "assigned to me" check compares against the Gmail address, which may not match its name.

**Gate:** reply to one real Slack DM and one real email from the Inbox session. In a coding session the bell counts them, and one Critical item shows the needs-you card.

---

**Inbox review against v1 and the design (2026-10-12)**, built and checked in tests, not yet in the app:
- **Your call:** a message opens under its row in the Inbox pane in **any** session, and is answered there. Drafting is a Haiku side call that never enters the coding chat. This replaces screen 4's reply card above the prompt and the "Replies are written in the Inbox session" toast.
- The open message: who, kind, time, title, details, the whole text (Gmail's thread through the connector, Jira's description and comments), attachments, and Open in Gmail, Slack, Jira or GitHub.
- The reply (ported from v1): Short, Detailed and Ask a question; Reply all (Gmail); Retry; Improve (Shorter, Friendlier, More formal, Fix grammar, or your words; before and after; Use this); Edit; Save draft (Gmail Drafts through the connector); Skip. Send has a 10 s Undo. After sending: Sent as you, and Delete from Slack. If the original was edited: "I re-read it · send".
- Gmail through Claude's connector sends again (v1's path: `send_plan`, a fresh `get_thread` check, the connector's `reply`, `send_done`).
- Calendar: Join now, Open in Calendar. GitHub: Open on GitHub, Ask Claude to review (fills your prompt). Jira: status, Move to (the issue's real transitions), Comment. All checked against the live Atlassian connector.
- The pane: Mark all read, Sources and Auto buttons, a banner per source that needs you (Resume or Fix), a demo note with "Use my accounts", "All caught up".
- **Inbox sources screen (new design: the canvas had none):** `/sb-inbox sources`, Sources in the Inbox pane, or "Inbox sources" in Switchboard. It shows each source with how it connects and its state; Slack's direct setup (paste two codes into the keychain); Gmail through the connector or direct; alerts (meeting card 1, 3, 5 or 10 min before, sound, Mac notification, quiet hours); and checking (restart, demo).
- Polling runs in any window, by lease: the Inbox session first, else one coding window. So the Inbox fills without an Inbox session.
- The Inbox chat reads the inbox with plugin tools `inbox_list`, `inbox_read`, `inbox_open`, in the Inbox session only. There is no send tool.
- Sound and a Mac notification (osascript, text as arguments) for Critical items and meetings, once each, respecting quiet hours.
- **Not built:** reading Slack through Claude's connector (its tools couldn't be checked here; the Sources screen says so and offers direct); hand-offs between sessions (not needed now that any pane replies).

### P8 · Calendar and the meeting card

**Goal:** screen 6.

**Tasks:**
- Sync the next 24 hours from the Calendar connector in the Inbox session, about every 60 s, under a lease. Without the Inbox session, a direct OAuth fallback if chosen.
- Every window keeps local timers: lead time (default 5 minutes; 1, 3, 5 or 10), then 1 minute, then the start.
- **Meeting card:** countdown ring, title, time, Meet link, attendees, Join now, Remind me in 1 min, In 3 min, Not going.
  - Takes the keyboard (P0-9), plays the sound, posts an OS notification.
  - A mod can't dim the whole window.

**Edge cases:**

| Case | Handling |
|---|---|
| Moved or cancelled meeting | Timers re-planned; the card updates or leaves |
| Two meetings at once | One card, a Join for each |
| Declined or all-day events | Never |
| You're typing | Wait until 2 s without typing |
| Screen sharing (if detectable) | OS notification only |
| Window hidden | OS notification and sound still fire |
| Time zones and DST | Event times in UTC; shown in yours |
| Join link not https | No Join button |
| The Inbox session closes mid-day | Already-planned timers still fire |

**Gate:** the card fires 5 minutes before a real meeting in a coding session, and Join opens the link.

---

### P9 · GitHub and Jira

**Goal:** both sources in the Inbox, and actions in replies and auto rules.

**Tasks:**
- **GitHub:** the notifications API every 60 s with a fine-grained token (chosen repos only) for review requests, mentions, CI failures and PR comments. Rate limits back off to the reset time.
- **Jira:** the Atlassian connector (it is already connected in this setup) or an API token. JQL every 60 s for assigned, mentioned, status changes and comments.
- **Actions:** open, comment, approve or request changes (GitHub); comment and transition (Jira). All through the guarded path.

**Edge cases:**

| Case | Handling |
|---|---|
| Token lacks access to a repo or project | Item shown; actions disabled with a reason |
| PR over 2,000 changed lines | Riskiest files first, a summary, and which files were skipped |
| CI flapping | One item per run, updated in place |

**Gate:** a real review request and a real assigned ticket are handled from the Inbox session.

---

### P10 · Auto rules and the send check

**Goal:** screens 5 and 7.

**Making rules:**
- `/sb-auto Ahmed Raza: if he asks for a PR review…` in the Inbox session.
- Haiku turns it into a rule card: When → Do pairs, "Only if" chips, Ask first or Auto, Save rule.
- New rules start in Ask first.

**Matching:**
- Deterministic checks first: sender, source, repo, hours, caps.
- Then Haiku decides "does this message ask for X?" with `$.model.classify(text, ['asks', 'does not ask', 'unclear'])`. The message is fenced as data, and the call has a timeout.
- Only `asks` goes on. `unclear` and timeouts become a normal item.
- Unsure means a normal item.
- Bots and messages Switchboard sent never trigger rules, so loops can't start.

**Doing:** a subagent limited to the rule's allowed tools (`$.agent.spawn`, Haiku unless the rule says otherwise). Every write goes through the guarded path.

**Ask first:** the send check card (screen 5) shows:
- what goes to whom;
- the checks (people list, same person, not sent before);
- sends used today;
- Send, Edit first, Don't send (focused).

**Auto pane (screen 7):**
- Right now, Auto mode switch, Pause all.
- Running tasks with Stop; waiting tasks with Check.
- Rules with Ask first or Auto pills.
- Today's log with Undo where possible: delete a message, cancel an invite, revert a transition, unarchive.

**Edge cases:**

| Case | Handling |
|---|---|
| Two rules match one item | The higher rule wins; the other is logged as skipped |
| Daily cap reached | Rule pauses until tomorrow |
| `/sb-pause` from any session | Stops everything, including running tasks |
| Inbox session closes mid-task | Task marked "interrupted", nothing sent |
| A rule needs a model stronger than Haiku | Shown on the card, with cost |
| Out of office | Separate rule type |
| Bot replies to an auto reply | Never auto-reply to bots or our own messages |

**Gate:** one week of rules in Ask first, then one rule switched to Auto, with no wrong sends and every action undoable or logged.

**Built 2026-10-12, not yet checked in the app** (`hooks/features/auto/`, the Auto section of `register.tsx`, `watcher/actions.py`):
- `/sb-auto <words>` → Haiku makes the rule (`making.ts`; each ask keeps its one action, new rules are Ask first). The rule card is a band card in the Inbox session, like the reply card, not a `CommandOutput` row: Save rule, Edit (puts the words back in the prompt), Cancel, Ask first | Auto.
- `/sb-auto` alone or `rules` opens the Auto pane; `on`, `off`, `resume`, `delete <n or name>`. `/sb-pause [1h]` works in any session through `$.store` (`auto.pausedUntil`); the Inbox session reads it before every action and every 15 s.
- Matching runs on new items in the Inbox session only: deterministic checks, then `$.model.classify` per pair with the message fenced in `<message>` tags and an 8 s timeout. A GitHub review request skips the model. The first rule that "asks" wins; later ones are logged as skipped.
- Send check (screen 5) is a band card, full or compact by the band's height. Send goes through the watcher's guarded path with the rule name and its cap (`send`/`archive` take `rule` and `cap`; `cap` checks the action log since local midnight).
- Review and booking run as agent types `switchboard:auto-review` / `auto-book` (hidden from the model with `agent.offer`), on Haiku, with tools picked from the session's connectors by name (never merge, delete, close or push). The `tool.call` hook refuses any other tool, and every call once the task is stopped or Auto is paused.
- Auto pane (screen 7): Right now, Auto mode switch, Pause all, running (Stop) and waiting (Check) tasks, rules (click the pill: Ask first → Auto → Off), today's log with Undo for Slack sends and archives.
- An "Auto" row in the Inbox session's band: counts, Open Auto, Pause all.

**Still missing:** sending replies to Gmail that came through Claude's connector (the task fails with a note; the connector may only offer drafts); the out-of-office rule type; a rule's stronger model and its cost on the card; the 12-hour activity chart; GitHub and Jira writes are unverified against the real connectors. Demo mode is the way to try it: `/sb-auto Bilal Ahmed: if he asks a question, draft a reply`, then `/sb-inbox demo on`, and his "Lunch at 1?" arrives 20 s later.

**Phase 9 fixes found here:** the desktop app names claude.ai connectors by an id (`mcp__642375f5-…__searchJiraIssuesUsingJql`), so Gmail, Calendar, GitHub and Jira are now found by their tools' descriptions, and polling only ever picks a read tool. Checked against the live Atlassian connector: Jira's search needs a `cloudId` (from `getAccessibleAtlassianResources`) and answers `{ issues: { nodes } }` with `webUrl`.

---

### P11 · Browser (terminal only)

**Goal:** screen F8.

**Ported from** zenbu-labs/terminal-browser's `claude-code-plugin/` glue (about 20 KB), MIT, "Copyright 2026 Zenbu Labs, Inc.". The browser itself is their app; we only call its CLI and never copy its engine.

**Why terminal only:** the desktop app's element table has `Client` but no `Image` or `Raster` (verified), so it can't show the frames. `/sb-browser` is registered only when `$.session.surfaces()` includes `terminal`, and hidden everywhere else.

**How it works:**
1. **Find the CLI:** `terminal-browser capabilities` must print JSON listing `embedding` and `image-frames`. Without it, `/sb-browser` explains how to install: `brew install terminal-browser`, or their install script, which we link to but never run for you.
2. **Check the terminal.** terminal-browser itself never checks; this is our addition.
   - It needs kitty graphics with Unicode placeholders: Ghostty, kitty, or other libghostty terminals.
   - We read `TERM_PROGRAM` and `TERM`, and refuse inside tmux or screen (`TMUX`, `STY`), with a clear reason.
3. **Start the bridge:** `terminal-browser claude-bridge launch`.
   - It finds the TTY and makes a 24-byte bearer token.
   - It serves on `127.0.0.1` on a random port, then prints `{ port }`.
   - The token stays in memory only. It is never logged or stored, and never shown to the model.
4. **Follow the state:** a long poll on `GET /state?version=` (1 s wait), with `Authorization: Bearer`.
5. **Frames:**
   - On a redraw, draw `<Image key="view" source={{ shm, format, width, height, generation }} columns rows />`.
   - Between redraws, push frames with `$.ui.blit({ requestId: 'switchboard', key: 'view', source })`. If the blit is refused, invalidate and redraw.
   - The image grid is capped at 255 cells per side.
6. **Input:** a `<Client module="./browser-surface.tsx">` laid over the Image.
   - `onPointer` and `onKey` are batched every 20 ms and posted to the module.
   - Our `ui.message` hook relays them to `POST /input`, and size changes to `/size`. Scroll becomes wheel events, at most 10 ticks.
   - **Fix over the original:** use `ClientPointerEvent.fine` (sub-cell positions in kitty and Ghostty). This removes the "mouse slightly off" problem in their README.
7. **Ctrl+G sends a page element to Claude:**
   - the browser posts `{ text, screenshot }` to the bridge;
   - our watch loop sees `inbox > 0`, calls `POST /inbox/take`, flattens control characters and newlines, and runs `$.prompt.fill({ text, mode: 'append' })`.
   - The text is marked as page content. It is data, and it only lands in your prompt box; nothing is sent until you press Enter.
8. **Pane:** the one `switchboard` pane, opened with `focus` and `columns: 100`. Closing it calls `POST /browser/close`.

**Using it from the Inbox:** links in Inbox items get "Open in pane" only when Browser is available; otherwise they open in your own browser.

**Edge cases:**

| Case | Handling |
|---|---|
| Desktop app, VS Code, mobile | Command hidden |
| tmux, screen, terminals without kitty graphics | Command shows the reason, nothing starts |
| CLI missing or too old (no `image-frames`) | Install or upgrade steps (`terminal-browser upgrade`) |
| terminal-browser's own plugin installed too | `$.command.list()` finds `/browser`; ours stays off and says so |
| macOS "allow local network" prompt | Explained once before the first launch |
| Bridge crashes or the port closes | Pane shows "page closed", with Reopen |
| Long-poll errors | Back off 1 s, 2 s, 5 s, then stop with "Browser stopped" |
| Narrow terminal (< 144 columns) | Pane inline (`rows`) instead of docked |
| Untrusted pages | Page text is data; ctrl+g text goes only to the prompt box, never sent by itself |
| Session ends | Bridge closed; no browser left running |

**Gate:** in Ghostty, `/sb-browser` with a PR URL renders. Clicks land exactly where you point, and ctrl+g puts an element in the prompt. In tmux, the command explains why it can't run.

---

### P12 · Polish, packaging, release

- Accessibility: every control is a real button, labels for icon buttons, contrast checked in both themes, and reduced motion respected.
- Performance pass against section 9.
- `marketplace.json` with a one-line install; README with setup per source; `THIRD_PARTY_NOTICES.md`; `SECURITY.md` with a threat model.
- Remove the v1 code from `main` once v2 has parity, in one commit.
- **Gate:** a clean install on a second Mac works from the README alone.

---

## 6b. End-to-end review (2026-10-12, your spec)

**Your spec, and what changed to meet it:**
- **Files:** opens by itself when Claude reads, edits or commits, in any session; closes 20 s after the turn unless you used it. Its auto-open is now on by default (stores from version 1 move to on). It may cover a pane you opened but didn't touch, which comes back after. Closing it blocks it only until the next turn.
- **Agents:** opens when one or more subagents run; closes 8 s after they all finish.
- **Replay:** only with `/sb-replay`. **Blast Radius:** unchanged. **Reflect:** a card when a message sets a rule; project or all projects.
- **Cache Tax:** a card when a big cold cache would be re-written. Keep-warm never starts by itself any more (its pings cost tokens); `/sb-cache warm` starts it.
- **Inbox:** notifications in every session; the pane opens only from a notification, the bell, `/sb-inbox` or the Switchboard pane's button.

**Zero tokens outside the Inbox session:**
- Reflect finds rules locally (`correction()` in `reflect/rules.ts`). No `$.model` calls remain.
- The Inbox is the orchestrator. Only the Inbox session calls the model: it drafts, improves, matches Auto rules and pre-drafts Critical and High replies. Other windows ask it through the queue (`request`, `request_get`, `drafts_get`). It renews an `inbox-alive` lease every 3 s, so a window knows whether to ask.
- What still costs tokens: the Inbox session's work and chat (Haiku), keep-warm pings only when you start them, and saved Reflect rules added to the system prompt for the rest of that session (a few lines).

**Connectors (each checked against the live connector):**
- Desktop connectors are switched on per session; a plugin sees only those that are on.
- Tools are found by name or description (servers are ids).
- Each source is polled by one window that has it, by lease (`poll:<source>`). The Inbox session takes the lease over.
- Calendar's `list_events` takes local `startTime`/`endTime`; its join link is in `conferenceUrl`, and you are the attendee marked `self`.
- Slack's search answers in Markdown (`slack_results()`); Gmail snippets arrive HTML-escaped.
- GitHub isn't connected as a Claude connector.

**Freezes fixed:**
- Session start no longer waits on Python (137 ms in the real engine).
- `/sb-inbox demo` and `/sb-inbox restart` start the watcher after answering.
- The meeting countdown redraws only the band, never the pane.
- Every catch-all hook falls back on failure.

**Removed:** v1's `mcp_server/` (the failing "switchboard" MCP server is left over from v1), Reflect's model prompt, Cache Tax's automatic keep-warm, and unused exports.

---

## 7. Cross-cutting edge cases

| Area | Case | Handling |
|---|---|---|
| Lifecycle | Hot reload | `session.start` runs again; state comes back from `$.state` and `$.store`; timers re-armed |
| Lifecycle | `/clear` | `session.end` without `session.start`; `classic.SessionStart {source:'clear'}` resets per-session views |
| Lifecycle | Resume, fork | Rebuild from the store and `$.agent.list()` |
| Lifecycle | Compaction | Nothing visible changes; costs recompute |
| Lifecycle | App quits mid-hold | Claude never ran the command; on restart nothing is pending |
| Windows | Two windows, same project | One watcher; arbiter state per window; shared settings in the store |
| Windows | Two windows, both coding | Bell and cards in both; needs-you card dismiss syncs through the queue |
| Surfaces | Narrow terminal (< 144 cols) | No unasked panes; card fallbacks |
| Surfaces | Mobile, VS Code | Text fallbacks; status line for counts |
| Other plugins | Another band plugin | Our rows first, theirs below via `next(e)` |
| Other plugins | Another plugin with the same hotkey | Our hotkeys act only while our surface holds the keys |
| Features off | Turned off mid-hold or mid-flow | Finish the current action, then stop; nothing half-done |
| Errors | A feature throws | Hook `.catch`: fail closed for Blast and sends, fail quiet for display; one toast at most |
| Errors | Watcher crashes | Restart with backoff; bell shows "Inbox paused" |
| Time | Laptop sleeps | Timers re-planned on wake; keepwarm stops if past the TTL |
| Versions | Older Claude Code | Plugin refuses to load below 2.1.295 with a clear message |
| Other plugins | The original mod is installed too (claude-reflect, cache-tax, savvy-progress, filetree, terminal-browser, blast-radius, replay-theater) | `$.command.list()` at `session.start` finds its commands. Our matching feature starts off, and the Switchboard pane says "X is installed; use one". Never two holds or two cards for the same thing |
| Setup | Function hooks not enabled (`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS`, which the reference repos ask for) | `check-plugin.sh` and the README check it and tell you how to enable it. Switchboard never edits your settings itself |

---

## 8. Security and privacy

- Secrets live in the OS keychain only, never in `$.store`, logs, prompts or the queue. `.env` is a git-ignored fallback.
- Minimum scopes per source (v1's list).
- Message content, page text and file content are always fenced as data in model prompts. Rules and actions come only from you.
- Every write goes through one guarded path: recipient or repo checks, allow-list, daily cap, idempotency key, action log with undo info.
- The Inbox model only sees items you open or that a rule runs on. Excluded labels, channels and keywords never reach it.
- Reflect never learns from message text, only from what you typed.
- Blast Radius fails closed. Cache Tax never sends anything without your click, except keepwarm pings you armed.
- The local queue is readable by your user only, and archived after 14 days.

---

## 9. Performance budgets

| Item | Budget |
|---|---|
| Hook own time | under 200 ms typical; 10 s hard limit (time inside `$` calls is free) |
| Render | One picture per section; under 100,000 chars per tree; 300 rows max per list |
| Git calls | `--no-optional-locks`; rev-parse 5 s, status 20 s, ls-files 10 s, du 15 s timeouts |
| Store | under 1 MiB used |
| Model calls | Haiku by default; Reflect 300 output tokens; drafts 400; caps per day shown in the Inbox |
| Background polling | Slack push; others 60 s; slower when you're away; never under the safety floor |

---

## 10. Testing

- **Pure modules** (parsers, classifiers, diff, arbiter, rule matcher): unit tests with fixtures from the repos and recorded tool results.
- **Hooks module:** `claude plugin test` on `terminal` and `desktop` for every screen: mount, find, press. The fake `$` answers process, store and model calls.
- **Python watcher:** pytest with fake Slack and Gmail clients; never real tokens.
- **Send path:** wrong recipient, double send, 429, deleted before reply, cap reached, rule allow-list.
- **Visual check:** each phase's gate compares the real desktop app with the canvas, dark and light, by screenshot.
- `check-plugin.sh` runs validate and test on every Claude Code on the machine before each commit.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Desktop can't match a design detail (pane width, Client, button colors) | P0 probes first; fallbacks listed; tell the user before building around it |
| The Inbox session isn't open | Collect-only mode; clear bell state; optional direct OAuth for Gmail and Calendar |
| `$.session.send` can't reach another desktop window, or asks for approval | Hand off through the shared queue instead (P0-8) |
| A display hook fails and blocks Claude | Every guard hook has a `.catch`: display features pass through, safety features (Blast, sends) refuse |
| Internal fields (`bashEditDiff`) change | Tested fallbacks; `check-plugin.sh` type-checks against each installed version |
| Upstream mods change | We own our code; repos are only references |
| Model cost creep | Haiku default, per-day caps, cost shown |
| API changes in new Claude Code | `check-plugin.sh` on every installed version; minimum version check |

---

## 12. Decisions (all taken as recommended, 2026-10-11)

1. **Order.** Recommended: P0 → Files → Replay → Blast Radius → Agents → Reflect → Cache Tax → Inbox → Calendar → GitHub/Jira → Auto → Browser. Local features first: they need no accounts and prove the UI kit. Alternative: Inbox first, as in v1.
2. **Files auto-open while Claude works.** Recommended: off (open with `/sb-files`).
3. **Agents auto-open for `/sb-flow` runs.** Recommended: on.
4. **Gmail and Calendar.** Recommended: Claude connector, running in the Inbox session. Alternative: direct OAuth, which also works with the Inbox session closed.
5. **Browser.** Keep it in this plan as the last phase (recommended), or drop it, since it only works in kitty and Ghostty.
6. **v1 code.** Recommended: keep it on `main` until v2 has parity, then remove it in one commit.
7. **The "light" agent tier.** Recommended: Haiku 4.5 at low effort, which is cheapest. savvy-flow uses Opus at low effort, which is stronger and costs more.
8. **Language of saved rules.** Recommended: the language you wrote the correction in. claude-reflect always writes English.

---

## Appendix A. API facts checked against Claude Code 2.1.295

Checked 2026-10-11 against the bundled `plugin-authoring` types for 2.1.295. "Verified" means the declaration and its doc comment say so. "Probe" means only the live desktop app can answer it (P0).

| Plan relies on | Status | Source in the types |
|---|---|---|
| One pane per id; reopening an id retitles it, never stacks | Verified | `PaneOpenArgs.id` |
| `focus` can be refused (text in prompt, dialog, survey, band) | Verified; plan adapted (4.2) | `PaneOpenArgs.focus` |
| `columns` sizes the terminal dock; `rows` the inline block | Verified for terminal; desktop is P0-3 | `PaneOpenArgs.columns`, `rows` |
| `$.ui.panes()` lists our open panes, survives reload | Verified | `ui.panes` |
| `ui.close` origin `person` / `plugin` / `unload`; a hook can keep it open | Verified | `PaneCloseInput` |
| Hide a command: `command.describe` → `isHidden`, refresh with `$.ui.invalidate` | Verified; no unregister exists | `command.describe` |
| `immediate` commands run mid-turn | Verified | `CommandSpec.immediate` |
| Force Haiku per session: `turn.step` rewrites `model`/`effort` | Verified; replaces the `config.set` idea | `TurnStepInput.model` |
| Force a subagent's model: `agent.spawn` | Verified | `agent.spawn` |
| `$.config.set` has no model row | Verified (built-in rows like `theme`, plus plugin fields) | `ConfigSetInput.key` |
| `$.session.send({ to: { sessionId } })` | Verified; cross-window is P0-8 | `session.send` |
| `session.receive` can consume a delivery so the model never sees it | Verified | `SessionReceiveResult.consumed` |
| `origin.plugin` on a received message is only a claim | Verified; never used as a guard | `SessionReceiveOrigin` |
| Hook budget 10 s own time; `$` calls free except `$.clock` waits | Verified | `HookBudget` |
| An overrun hook with no `.catch` lets `next(e)` run | Verified; Blast `.catch` must deny | `HookBudget.ms` |
| `.catch` gets 1 s | Verified | `HookBudget.catchMs` |
| `$.model.complete({ model, timeoutMs })` | Verified | `ModelCompleteInput` |
| `$.model.classify(text, labels, { model })` | Verified; used for Reflect and Auto first pass | `ClassifyOptions` |
| `$.mcp.call('claude.ai Gmail', tool, args)` with no permission prompt | Verified | `mcp.call` |
| `$.session.usage().cost` as `/cost` totals it; `context` window figures | Verified | `SessionUsage` |
| `$.prompt.fill({ text, mode })` | Verified | `PromptFillArgs` |
| `$.ui.notify(text, { title })` | Verified | `NotifyOptions` |
| Button `variant: 'primary' \| 'secondary'` | Verified; the clay color on desktop is P0-10 | `ButtonProps.variant` |
| Bash result: `gitOperation` (commit, push, branch, PR) | Verified | tool output `Bash` |
| Bash result: `bashEditDiff` | Exists but `@internal`; fallback kept | tool output `Bash` |
| Bash result lists files read | **Not present**; our own parser | tool output `Bash` |
| Edit result: `originalFile`, `structuredPatch`, `userModified` | Verified | tool output `Edit` |
| `prompt.submit` `e.origin.kind` (`composer`, `bridge`, `plugin`, …) | Verified; Reflect and Cache Tax skip non-person prompts | `prompt.submit` |
| `turn.complete` reason `answer` / `aborted` / `refusal` / `error` | Verified | `TurnCompleteReason` |
| `agent.spawn` has `parentAgentId`; the result has `teammateId`; `$.agent.list()` gives `{ id, status, parentId, spawnedBy }` | Verified | `AgentSpawnInput`, `AgentInfo` |
| `classic.SessionStart` on resume: `seconds_since_last_response`, `prompt_cache_likely_expired`, `estimated_cache_write_usd` | Verified | `SessionStartHookInput` |
| `classic.PreModelSwitch` / `PostModelSwitch`: `cache_ttl`, `prompt_cache_warm`, `estimated_cache_write_usd` | Verified | `PostModelSwitchHookInput` |
| `$.model.fork` always returns a result | Verified | `model.fork` |
| `$.tool.register` tools are named `mcp__<plugin>__<name>` | Verified | `tool.register` |
| `Image` (shm frames) and `$.ui.blit`: terminal only; desktop has no `Image` | Verified | element tables |
| `ClientPointerEvent.fine` sub-cell positions | Verified | `ClientPointerEvent` |
| Client element on desktop | P0-2 | element table |
| Session deep link on desktop | P0-7 | none in the types |
