# Switchboard end-to-end test plan (2026-10-15)

Goal: before the live test, prove every feature works behind the scenes with zero crashes, fix what
breaks, and remove what isn't needed. Each step is **test → fix → re-test**; nothing moves on while a
step is red.

## 0. Baseline (done)

| Check | Result |
|---|---|
| `tsc -p .` | clean |
| `claude plugin validate .` (2.1.296, 2.1.295) | passes; 1 warning (root CLAUDE.md isn't plugin context — expected) |
| `claude plugin test .` (2.1.296, 2.1.295) | 183 pass, 0 fail |
| `pytest` | 92 pass |
| `tsc --noUnusedLocals --noUnusedParameters` | one unused param (`blast/pictures.ts` `hover`) |
| Unused exports / Python defs | no dead TS functions; Python: `now_iso`, `HEADERS`, `backoff_delays`, CLI `list`/`actions` unused by the plugin |

## 1. Code review sweep (four parallel reviewers, read-only)

1. **Local features** — Files, Replay, Blast Radius, Agents, Reflect, Cache Tax (`register.tsx` 1–1120 + `features/*`).
2. **Inbox side** — connectors, watcher spawn/pump, needs-you card, drafts, send + Undo, meeting timers, Auto rules.
3. **Shell** — `session.start`, every `/sb-*` command, pane render, `ui.message` hover/press, AbovePrompt band, arbiter, store migration, theme/kit.
4. **Python** — watcher, queue, actions (guarded send path), connectors ingest, CLI, safety, adapters.

Each finding is verified in code, then fixed with a test that fails before the fix.

## 2. Crash-proofing checklist (every hook and timer)

- Every gating hook has a `.catch` (validator lists them); display features pass through, Blast and sends refuse.
- No un-awaited promise without `.catch` inside `$.clock.every/after` callbacks, the watcher pump, or `serveRequests`.
- After `next(e)` nothing throws (Replay, tool.call catch-all, band).
- The band always calls `next(e)` so other plugins' rows still draw, even when our render throws.
- `session.start` running twice (hot reload, `/clear`, resume) never doubles timers, watchers or intervals.
- A feature switched off mid-flight stops its timers, releases its pane slot, and clears its card.
- Module-level Maps (`background`, `agentTypes`, `blastDecisions`, `blastCalls`, …) are cleared or capped.

## 3. Feature-by-feature end-to-end scenarios (fake engine, both surfaces)

| Feature | Scenarios |
|---|---|
| Switchboard hub | open pane; toggle each feature on/off; commands hide/show; settings survive reload; old store versions migrate |
| Side pane (arbiter) | one slot; user pane beats auto pane; closed pane doesn't reopen this turn; pane released when its feature turns off; auto-close timers |
| Notifications | toast ≤ 60 s; status line counts; quiet hours; no repeat toast for the same item; meeting sound once per stage |
| Files | auto-open on read/edit/commit; folder expand; search; sizes; shell edits; subagent edits; closes 20 s after turn |
| Replay | `/sb-replay` only; steps, diff, git diff; store under 1 MiB; 3 turns max |
| Blast Radius | hold → side pane → Run / Don't run; 1 min default wait then runs; `/sb-blast wait none`; refuses on error |
| Agents | opens while subagents run, closes 8 s after; display only (no model calls) |
| Reflect | local rule detection, card in band, save to CLAUDE.md (project/global), compact card in low band |
| Cache Tax | card only when a big cold cache would be re-written; keep-warm only from `/sb-cache warm` |
| Inbox | demo stream; snapshot/new/edit; needs-you card; bell count; filters; open message; drafts (Inbox session only); send with 10 s Undo; save draft; read/archive |
| Meeting | lead time → 1 min → start; Join only https; declined meetings ignored; moved meeting replaces timers |
| Auto rules | make rule from chat; three checks (rule, trusted sender, clear request); daily cap; pause/resume; anything unsure → normal alert |

## 4. Python watcher and guarded send path

- Stream: `python -m watcher.main --stream` in demo mode emits valid NDJSON only (no stray prints); survives bad input; lock file keeps one watcher; a stale lock after a crash is taken over.
- Queue: de-dup by id, edits replace in place, archive after 14 days, two writers at once (SQLite busy).
- Send path: wrong recipient, double send (idempotency), 429, deleted message, daily cap, rule allow-list, Undo.
- CLI: every command the plugin calls answers JSON on bad input instead of a traceback.
- TS ↔ Python contract: field names the plugin reads match what Python writes.

## 5. Clean-up

- Remove dead code (unused functions, CLI commands, leftover v1 pieces) and needless `export`s.
- Merge duplicated helpers (e.g. `connectorResults = connectorThreads`).
- Token budget: no model calls outside the Inbox session; drafts only for items you open or Critical/High; prompts fenced and trimmed; nothing large added to the system prompt each turn.

## 6. Gate before the live test

`sh scripts/check-plugin.sh` green on both Claude Code versions, `pytest` green, demo watcher smoke test
green. Then the live checklist: Inbox session in the desktop app, one real Slack DM and one real email
replied from the pane, a meeting card, an Auto rule run end to end, every feature toggled on both
surfaces, light and dark.

## 7. Results (2026-10-16)

Four reviewers and a privacy audit found ~70 issues; every one below is fixed and covered by a test
unless marked. Final gate: `check-plugin.sh` green on 2.1.296 and 2.1.295 (188 hook tests), `pytest` 98,
demo watcher and CLI send path checked end to end.

**Safety**
- A reply could go twice: the send key changed on every Send press, and a "sent" key could be claimed again
  after 60 s. Now the key is the message plus the exact text, a sent key never sends again, and an attempt
  that never finished comes back as "may have gone out" instead of being retried blind (Gmail and Slack).
- A key typed into a band card (which keeps the keyboard after a click) could run or cancel a held Blast
  command; and hotkey 1 on a card shared the band with the held row's Run. Keys now count only from the
  owner's own pane pictures, and a held row shows alone.
- Blast Radius locked up for the session when an approved command was interrupted. The hold, card and
  pane are always let go now.
- Auto: a rule with no person acted on anyone without asking (now always Ask first); review and booking
  agents could get write tools (create/update files, close PRs, comment anywhere; now reads plus posting a
  review or creating one event) and weren't held to the rule's repos; booking found no tools on the desktop.
- Two sessions could both act as the Inbox after `/sb-inbox here` (double auto replies). The old one now
  steps down within 3 s; auto sends are keyed by rule and message; a second Send press can't run twice.
- Excluded items' titles reached the model through `inbox_list`; untrusted names sat outside the fences.
- A rule's daily cap could be passed by two tasks at once; excluded items weren't refused by the send path.

**Crashes and stuck states**
- The Files tree (286k characters at 300 rows) and a busy Inbox pane were over the engine's 100k limit,
  which unmounts the pane. Capped and tested.
- The side pane threw on mobile (no text field); a pane draw that fails now says so.
- The watcher never restarted after a crash (now backs off 5 s → 5 min); two starts could orphan a stream.
- A deleted Slack DM channel blocked Slack catch-up forever; Resume after a rejected token never restarted
  the source; thread replies were always refused as "deleted" (Slack `limit=1` returns the parent first).
- One bad connector record aborted a whole ingest; a stored row from another version broke the queue.

**Wrong behavior**
- Slack replies through Claude's connector always failed (they went to Gmail's tools). Now a guarded Slack
  path: recipient check, message-still-there check, idempotency, action log.
- Every window but the first toasted the same unread items every minute; alerts rang once per window.
- Calendar times never showed (epoch numbers where ISO was read); items with no time were archived at once.
- Poll cursors moved on failure, losing messages; connectors switched on later were never found.
- Inbox timers kept polling and spending after Inbox was switched off, and doubled on each switch.
- Cards and panes of switched-off features stayed (a held Cache Tax message blocked every lower card).
- Settings from one window overwrote another's; `/clear` lost the Inbox role.
- Cancelled meetings still rang; "Not going" was undone by the next poll; the meeting tick never stopped.
- Saving a Reflect rule re-wrote the whole prompt cache; Undo pressed as the timer fired still sent.

**Removed:** `scripts/run.sh` and the `mcp` dependency (v1's MCP server), `Queue.counts`, `changed_since`,
the adapter Protocol, `now_iso`/`HEADERS`/`backoff_delays`, the `inbox-home` pane reason, the `reply` card,
`hasReplay`, `MultiEdit`, the unenforced store-size helper, eight copies of `withAction`, twelve copies of the
pane width, three copies of the connector patterns, a duplicate Jira cloud-id lookup, two duplicate git
refreshes per Bash command.

**Not changed (your call):** the Critical meeting alert stays a band card (CLAUDE.md asked for a blocking
dialog; the v2 design chose the card). `HOME_MODEL` is a full id while drafts use the `haiku` alias.

## 8. Before the live test

- `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` is **off** in `~/.claude/settings.json`: add `"CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1"`
  under `env`, or Switchboard won't load.
- The Python environment rebuilds once (the `mcp` dependency is gone).
