# Screens

Approved design: Claude's own theme, light and dark. Each screen below has light and dark screenshots in `screenshots/` and its interactive source in `source/` (Claude Design canvas format, `.dc.html`; open it only as a reference for exact spacing, colors and states, since it needs the canvas runtime to render). Tokens are in `tokens/`.

Mock data (names like Ahmed Raza, Bilal Ahmed) is fictional.

## 1 · Inbox pane — `01-inbox-*.png`, `source/Inbox.dc.html`

Right-side pane (about 460 px) next to the Claude Code transcript.

- **Header:** serif "Inbox", live dot, "8 new · 2 critical", an "Auto on" pill, a settings button
- **Source filters:** one icon button per source plus All, each with its count; the selected one is tinted in that source's color
- **Up next card:** the next meeting, a draining countdown bar, attendee avatars, a Join button
- **Item row:** source badge (icon on tint), sender, one-line preview, time, level dot (a Critical item's badge pulses); a bolt chip such as "Review ready" or "Archived" when an auto rule acted
- **Expanded item, reply sources (Slack, Gmail):**
  - message quote
  - sparkle + chips Short / Detailed / Ask, with a preview box
  - Send (primary) and icon buttons Improve, Edit, Save draft, Skip
  - Send shows a 3 s progress bar with Undo (10 s in production), then "Sent as you"
- **Expanded item, action sources (GitHub, Jira, auto results):** primary action plus two secondary actions with icons
- **Toasts:** stacked bottom-left of the transcript, slide in with a spring; Critical gets a red border

## 2 · Auto mode in the chat — `02-auto-mode-chat*.png`, `source/AutoChat.dc.html`

- **User message:** `/auto Ahmed Raza: if he asks for a PR review…`
- **Claude's rule card:**
  - person avatar, name and sources
  - an Ask first / Auto switch
  - When → Do pairs, each with icons; the Do side is tinted in its source color
  - Only if chips (repo acme-*, work hours, max 5/day)
  - Save rule and Edit; after saving, "✓ Rule active · Auto" (see the `-saved` screenshots)
- **Live task cards in the transcript:**
  - Running: progress bar plus Stop
  - Waiting: Approve
  - Done: Undo
- **Band above the prompt:** Auto · ● 1 running · 1 waiting · 7 rules on · Pause all
- **Prompt hint:** "Type /auto @person and say what to do…" with /rules and /pause chips
- **Side pane "Auto mode":**
  - master switch
  - 3 stat tiles: done today, running, waiting
  - People list: avatar, source icons, mode pill
  - General rules list with mode pills
  - a 12-hour activity bar chart (latest bar in accent)

## 3 · Meeting popup — `03-meeting-popup-*.png`, `source/Meeting.dc.html`

- Dims and blurs the Claude window and centers a dialog about 480 px wide that holds the keyboard
- **Calendar pill:** source icon and label, with a bell that shakes
- **Countdown ring:** 168 px, accent stroke, with a serif mm:ss inside; it starts at the lead time
- **Meeting details:** serif title, time and meeting link, overlapping attendee avatars
- **Buttons:**
  - full-width primary "Join now"
  - a row of three: ⏰ 1 min, ⏰ 3 min, Not going
- **Also shows** a desktop (OS) notification at the top right

## 4 · Sources and priorities — `04-sources-priorities-*.png`, `source/Sources.dc.html`

- **Source tiles:** icon, name, status dot (Live pulses; "Every 60 s" for polled sources), on/off switch; plus an "Add source" tile
- **Four level columns:** Critical, High, Normal, Quiet
  - each column has a colored top border, a serif title and a count
  - effect chips per column: Popup / Desktop / Sound, Toast stays / Sound, Toast 6 s, Badge
  - rule chips (source icon + label); clicking a chip moves it to the next level
  - "+ Add" at the bottom of each column
- **Bottom row:** Meeting popup lead time (1 / 3 / 5 / 10 min), Focus switch, Quiet hours (20:00 to 09:00)

## Terminal (CLI) equivalents

The same content, drawn with the terminal palette in `tokens.json`:

- **Toast:** a `╭─ 💬 Slack · DM · now  #12` box
- **Inbox:** `/inbox` list with ↑↓ selection
- **Reply options:** the built-in option picker
- **Thinking:** a spinner while Claude drafts
- **Send:** a countdown bar with `u` to undo
- **Fallback:** emoji become `[DM]`, `[MAIL]` and similar tags when unsupported
