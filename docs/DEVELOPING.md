# Developing Switchboard (v2)

The build plan is [BUILD_PLAN.md](BUILD_PLAN.md). The engine's API reference is the types file it writes: `.claude/types/claude-code.d.ts` here (git-ignored; refresh it from the bundled `plugin-authoring` skill after an upgrade), or `.claude-plugin/types/` once a session hot-loads the plugin.

## Versions

- **Minimum: Claude Code 2.1.295**, the desktop app's bundle on 2026-10-11. The terminal had 2.1.296.
- `scripts/check-plugin.sh` checks every Claude Code on the machine: the terminal's, and the desktop app's newest bundle (`<version>/<hash>/claude.app`). It type-checks, validates, runs the tests, and says whether function hooks are on. Run it before every commit.
- Function hooks need `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` (settings `env`, and for `claude plugin test`). Switchboard never edits your settings.

## How the code is laid out

```
hooks/register.tsx        the one hooks module: every $ call, every on(...)
hooks/core/               pure rules: arbiter (what shows), features + commands, store (settings)
hooks/ui/                 theme tokens, the click helper, picture builders
hooks/features/<name>/    pure views and logic per feature
types/index.d.ts          the state contract and the shared types
tests/hooks/              claude plugin test: pure rules and UI on terminal + desktop
```

## Rules the engine enforces (checked 2026-10-11 on 2.1.295 and 2.1.296)

- **One hooks module per plugin.** A second entry in `hooks.json` `modules` is refused.
- **`$` crosses no import.** A function that takes `$` must be declared at the top level of `register.tsx` (a `function`, or a `const` bound to one). Nested helpers inside `register` are refused too. Features get data and callbacks, never `$`.
  - A callback object built in `register.tsx` (closures over `$`) may be handed to an imported function: that passes validation.
- **The state contract is self-contained.** `types/index.d.ts` may not import anything. Shared types live there, and the hooks import them from it (`../../types/index.d.ts`).
- **Name clash in the contract.** Inside `declare module 'claude-code'`, a bare name means the engine's own type when it has one. `Settings` is one (`Readonly<Record<string, unknown>>`), so our settings type is declared as `SwitchboardSettings` and the state key is `prefs`.
- **State refs are literal consts** in the file that uses them: `atom({ plugin: 'switchboard', key: 'arbiter' } as const, …)`.
- **Gating hooks get a `.catch`** (`command.run`, `ui.close`, and later `tool.call`, `agent.spawn`, `prompt.submit`). Display features pass through on error; safety features (Blast Radius, sends) refuse. A hook that overruns its 10 s with no `.catch` has `next(e)` run for it.
- **Don't name a binding `h`** (the JSX factory) and **don't shadow `next`**.
- **Toasts last 60 s at most**; `$.ui.toast` returns nothing (no `.catch`).
- **Commands can't be unregistered.** A `command.describe` hook hides them (`isHidden`), and `$.ui.invalidate('command.describe')` refreshes the menu after a feature is switched.

- **One catch-all hook per event.** A second `on('tool.call', hook)` without a matcher is refused at load. Files owns the catch-all; Replay matches `{ tool: /^(Edit|Write|NotebookEdit|Bash)$/ }` (a matcher takes a RegExp). `MultiEdit` is not a tool in 2.1.295.
- **A hook that waits does not see state written meanwhile.** Blast Radius holds a Bash call in a loop of `$.process.run(['sleep', '0.25'])` (free time under the 10 s budget); a press arrives through another hook and writes `$.state`, but the waiting hook kept reading the old value (seen in tests on 2.1.295). Signals between a waiting hook and others go through module variables (`blastDecisions`, `blastHolder`); `$.state` is for what is drawn.
- **After `next`, a hook must not throw.** The call has run; Replay wraps its post-`next` work in `try`.
- **A rendered tree over 100,000 characters (or 20,000 nodes, 32 deep) is unmounted.** Pictures count in full: a Files row is ~640 characters, an Inbox row ~1,200, and each picture repeats the theme style (~2,400). The Files desktop tree draws at most 120 rows in pictures of 20; the Inbox pane at most 60 rows. Tests check both.
- **Don't add to the system prompt mid-conversation** (`prompt.compose` sections): it changes the cached prefix and the next turn re-writes the whole cache. Reflect hands a saved rule to Claude once, as `additionalContext` on `classic.UserPromptSubmit`; CLAUDE.md has it after.
- **`ui.message` keys and presses carry where they came from:** `e.component` (`Pane` or `AbovePrompt`) and `e.element` (the Client's key, `<picture>:hits`). A band picture keeps the keyboard after a click, so Blast and Replay act on a key only when it came from their own pane pictures, and presses are looked up by component.
- **Settings are saved through `savePrefs`**, which reads the store first: another window may have changed them since this one started.
- **`$.mcp.call` goes through the person's permission rules** (seen live on desktop 2.1.295, 2026-10-16). Nobody can answer "ask" for a plugin's call, and auto mode's classifier gives it no verdict, so a connector tool the rules don't allow is refused (`$.mcp.call(server, tool) refused: …`). A plugin's own `tool.check` hook is not consulted, and a plugin must not grant itself permissions. The source row then says "Needs your OK" with **Allow**, which fills the prompt with the read-only tools to add to `permissions.allow` (`refusedRules`, never a tool that sends).

## Drawing on the desktop

- **Pictures with a see-through Client over them** (`hooks/ui/click.tsx` + `hooks/ui/hits.tsx`), decided 2026-10-11. The Client posts `{ hover: key }` and `{ press: key }`; `register.tsx` keeps `hover` in state (the pictures draw it) and runs `presses.get(key)`. Never lay an app `Button` under a picture: the desktop draws its hover box on top of the picture.
- Text-only controls can be drawn inside a Client from Box and Text with background colors (claude-code-filetree's way); hover there is instant.
- Measured grid: one column ≈ 7.85 px, one row ≈ 19 px.
- Pictures carry the light and dark tokens as CSS variables and follow `prefers-color-scheme` (`hooks/ui/theme.ts`). The terminal draws with Claude ThemeKeys (`claude`, `success`, `warning`, …), which follow the person's theme.
- Animated (`isInteractive`) Svgs reload on every redraw and flicker: don't use them for panes that redraw.

## Client regions (verified live on desktop 2.1.295, 2026-10-11)

- A `Client` loads on the desktop app and reports the pointer: `enter`, `move`, `leave`, `down`, `up`, in whole cells (`fine` is null on desktop). This is how custom buttons work without the app's button hover (P0-2).
- **A Client's region is exactly as big as what its module draws.** `surface.rows` starts at 1, so a module that draws `surface.columns × surface.rows` stays one row tall and only its top row takes the pointer. Pass the size in props and draw that.
- Drawn inside a Client (Box and Text with background colors), buttons hover and press instantly, as claude-code-filetree's rows do.

## Scrolling (tried live on desktop 2.1.295, 2026-10-11)

- Let the app scroll panes natively. A fixed header with a self-scrolled area underneath was tried and dropped: the desktop sends the wheel (`ui.scroll`) only while the pane's content overflows, a Client gets no wheel events, and the result glitched.
- To bring something into view, draw it under its own `key` and call `$.ui.scroll({ to: { key }, in: PANE_ID, block: 'nearest' })` after the redraw lands. The Files tree is drawn in pictures of 8 rows for this.
- A Client takes `<key>:hits`, never the same key as the Box around its picture, so a key names one element.

## Testing

- The fake engine (`tests/hooks/control.test.tsx`) also answers `turn.start`, `turn.complete` (`{ text: e.answer }`) and an empty `AbovePrompt` beneath the plugin, so the band can call `next(e)`. Tool calls are raised with `$.tool.call({ tool, ...input })` and answered by the test's own `tool.call` hook.
- A hook that waits (Blast Radius) is tested on the mock clock: the fake `sleep` process awaits `clock.sleep(250)`, the test starts `$.tool.call` unawaited, `settle()`s, mounts and presses without awaiting the press (an act settles only with the work it set going, the held call included), then `advance()`s and awaits the call.
- A classic event (`$.classic.SessionStart(...)`) needs a test hook beneath the plugin to answer it (`on('classic.SessionStart', () => ({}))`), or the engine says nothing answers it. Call-style events the plugin makes (`session.model`, `session.usage`, `store.delete`, `model.fork`, `ui.log`) are answered with `{ value }`.
- Long waits (Cache Tax's hours) are fine on the mock clock: `advance(2 * HOUR)` runs every timer due on the way, the 1 s Agents tick included, in well under a second.
- macOS has no `timeout`; limit a test run with `perl -e 'alarm 150; exec @ARGV' claude plugin test .`.
- Pictures can be looked at with `node scripts/preview.ts` and WebKit (`qlmanage -t`); librsvg ignores the CSS variables the pictures color with.

- Pure modules are tested directly (`tests/hooks/arbiter.test.ts`, `core.test.ts`).
- UI tests mount the pane on `terminal` and `desktop` and press by key. Hooks beneath the plugin stand for the engine: `store.get`/`store.set` from a Map, `ui.open`, `ui.panes`, `session.surfaces`, `session.id`, `command.register`.
- A test registers its hooks before its first `$` call. The kit has no way to raise a person's pane close (`$.ui.close` isn't on the test `$`); the arbiter's unit tests cover that rule.
- `$.command.run` in a test takes the full input (`args`, `origin`, `presentation`).

## Trying it live

An installed plugin runs from a copy made at install time (`~/.claude/plugins/cache/…`), not from this folder: after a change, `claude plugin uninstall switchboard@switchboard && claude plugin install switchboard@switchboard`, then start a new session. With a `.sb-dev` file in the plugin folder, each session writes `.sb-dev-log-<session>.json` there.

The plugin folder is linked into this session's mods folder (`~/.claude/dev-mods/<session>/switchboard`), so a session that enables hot reloading loads it and reloads it on every edit. A hot-loaded mod gets `.claude-plugin/types/` written beside it; that folder is git-ignored.

The phase 0 probe (`sb-p0-probe`, `/sb-probe`) sits beside it and answers the P0 questions that only the live desktop app can. It writes what happens to `scratchpad/probe/p0.json`.
