// The Inbox on screen: the needs-you card and the bell above the prompt in a coding session (screen 1),
// and the Inbox pane (screens 3 and 4) in any session: the list, and the open message under its row with
// its reply (Slack, Gmail) or its actions (Calendar, GitHub, Jira). Pictures with see-through Clients on
// the desktop, text with real Buttons in the terminal. Pure.

import type { ElementConstructor, InputProps, RenderElement } from 'claude-code'
import { clickable, paneWidth, withAction, type Basic, type Pictured, type Presses } from '../../ui/click.tsx'
import { sectionSvg } from '../../ui/kit.ts'
import { IMPROVE_PRESETS } from './drafts.ts'
import {
  BADGE, REPLY_SOURCES, SOURCE_NAME, ago, bellCount, canSend, filters, lists, newToday, replyText, rowText, sourcesSummary, type InboxItem,
  type InboxReply, type InboxState, type ReplyOption,
} from './model.ts'
import { needsButtonsSvg, needsCardSvg, statusSvg, filtersSvg, type RowMark } from './pictures.ts'
import {
  actionRow, bannersSvg, calendarSvg, demoSvg, detailLine, emptySvg, githubSvg, improveSvg, jiraSvg, messageSvg, replyActionsSvg, replySvg, rowsSvg,
  toolbarSvg, type Problem,
} from './open.ts'

export type InboxActions = {
  /** Open a message under its row (again: close it). */
  open: (id: string) => void
  filter: (key: string) => void
  search: (query: string) => void
  /** The needs-you card in a coding session. */
  openInInbox: (id: string) => void
  remind: (id: string) => void
  dismiss: (id: string) => void
  bell: () => void
  /** The pane's toolbar and notes. */
  allRead: () => void
  sources: () => void
  openAuto: () => void
  resume: (source: string) => void
  /** A source whose last check failed: check it again now. */
  recheck: (source: string) => void
  /** A source refused by the permission rules: put the request to allow its read-only tools in the prompt. */
  allow: (source: string) => void
  demoOff: () => void
  /** The open message. */
  link: () => void
  close: () => void
  /** Its reply. */
  option: (option: ReplyOption) => void
  replyAll: () => void
  retry: () => void
  send: () => void
  startEdit: () => void
  submitEdit: (text: string) => void
  cancelEdit: () => void
  improve: () => void
  improvePreset: (index: number) => void
  improveCustom: (text: string) => void
  improveUse: () => void
  improveAgain: () => void
  improveBack: () => void
  saveDraft: () => void
  skip: () => void
  undo: () => void
  sendAnyway: () => void
  backToReply: () => void
  deleteSent: () => void
  /** Its actions. */
  comment: () => void
  submitComment: (text: string) => void
  cancelComment: () => void
  move: (transitionId: string) => void
  askReview: () => void
  join: () => void
}

type WithInput = { Input: ElementConstructor<InputProps> }

function run(actions: InboxActions, key: string, cardId = ''): void {
  if (key.startsWith('inbox:open:')) actions.open(key.slice('inbox:open:'.length))
  else if (key.startsWith('inbox:filter:')) actions.filter(key.slice('inbox:filter:'.length))
  else if (key.startsWith('inbox:resume:')) actions.resume(key.slice('inbox:resume:'.length))
  else if (key.startsWith('inbox:recheck:')) actions.recheck(key.slice('inbox:recheck:'.length))
  else if (key.startsWith('inbox:allow:')) actions.allow(key.slice('inbox:allow:'.length))
  else if (key.startsWith('inbox:fix:')) actions.sources()
  else if (key.startsWith('reply:opt:')) actions.option(key.slice('reply:opt:'.length) as ReplyOption)
  else if (key.startsWith('jira:move:')) actions.move(key.slice('jira:move:'.length))
  else if (/^reply:improve:\d$/.test(key)) actions.improvePreset(Number(key.slice(-1)))
  else {
    const simple: Record<string, () => void> = {
      'inbox:open': () => actions.openInInbox(cardId), 'inbox:remind': () => actions.remind(cardId), 'inbox:dismiss': () => actions.dismiss(cardId),
      'inbox:bell': actions.bell, 'inbox:allread': actions.allRead, 'inbox:sources': actions.sources, 'auto:open': actions.openAuto,
      'inbox:demo-off': actions.demoOff, 'inbox:link': actions.link, 'reply:close': actions.close, 'reply:all': actions.replyAll,
      'reply:retry': actions.retry, 'reply:send': actions.send, 'reply:edit': actions.startEdit, 'reply:improve': actions.improve,
      'reply:improve:use': actions.improveUse, 'reply:improve:again': actions.improveAgain, 'reply:improve:back': actions.improveBack,
      'reply:draft': actions.saveDraft, 'reply:skip': actions.skip, 'reply:undo': actions.undo, 'reply:anyway': actions.sendAnyway,
      'reply:back': actions.backToReply, 'reply:delete': actions.deleteSent, 'jira:comment': actions.comment, 'gh:review': actions.askReview,
      'cal:join': actions.join,
    }
    simple[key]?.()
  }
}

const widthOf = (columns: number) => paneWidth(columns)
const itemAlt = (item: InboxItem, now: number) => `${SOURCE_NAME[item.source]} from ${item.from.name}: ${rowText(item).what}, ${ago(item.receivedAt, now)} ago`

/** Sources that need you: stopped, paused, not set up. */
export function problemsOf(state: InboxState): Problem[] {
  return Object.entries(state.sources)
    .filter(([, one]) => ['error', 'permission', 'auth', 'paused', 'setup'].includes(one.state))
    .map(([source, one]) => ({ source, state: one.state, message: one.message }))
    .slice(0, 6)
}

// ---- Above the prompt ------------------------------------------------------------------------------

/** A coding session: the Critical item's card (when there is one) and the bell. Null: nothing to show. */
export function needsBand(elements: Basic | Pictured, isDesktop: boolean, state: InboxState, card: InboxItem | null, now: number,
                          columns: number, actions: InboxActions, hover: string, presses: Presses): RenderElement | null {
  const count = bellCount(state)
  if (!card && !count) return null
  const { Box } = elements
  const act = (key: string) => run(actions, key, card?.id ?? '')
  if (isDesktop && 'Svg' in elements) {
    const width = widthOf(columns)
    const buttons = needsButtonsSvg(width, !!card, count, hover)
    const picture = card ? needsCardSvg(width, card, now) : null
    return (
      <Box key="inbox-band" flexDirection="column" gap={picture ? 1 : 0}>
        {picture && card ? clickable(elements, 'inbox-needs', picture.svg, `Needs you now: ${itemAlt(card, now)}`, width, picture.height, [], presses) : null}
        {clickable(elements, 'inbox-needs-buttons', buttons.svg, `${card ? 'Open in Inbox, Remind me in 1 hour, Dismiss. ' : ''}${count} in Inbox`,
          width, buttons.height, withAction(buttons.parts, act), presses)}
      </Box>
    )
  }
  const { Button, Text } = elements
  return (
    <Box key="inbox-band" flexDirection="column">
      {card ? (
        <Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1}>
          <Text color="warning" bold>{`● NEEDS YOU NOW · ${SOURCE_NAME[card.source].toUpperCase()}`}</Text>
          <Text bold wrap="truncate-end">{card.title || card.body}</Text>
          <Text dimColor>{`${card.from.name} · ${ago(card.receivedAt, now)} ago`}</Text>
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            <Button key="inbox:open" label="Open in Inbox" hotkey="1" onPress={() => actions.openInInbox(card.id)} />
            <Button key="inbox:remind" label="Remind me in 1 hour" hotkey="2" onPress={() => actions.remind(card.id)} />
            <Button key="inbox:dismiss" label="Dismiss" hotkey="3" onPress={() => actions.dismiss(card.id)} />
          </Box>
        </Box>
      ) : null}
      <Box flexDirection="row" justifyContent="flex-end">
        <Button key="inbox:bell" plain label={`🔔 ${count} in Inbox`} onPress={actions.bell} />
      </Box>
    </Box>
  )
}

// ---- The pane --------------------------------------------------------------------------------------

/** The rows of a list, cut after the open message so its card shows right under its row. */
const NEEDS_ROWS = 25
const LIST_ROWS = 60

function chunks(items: readonly InboxItem[], openId: string): InboxItem[][] {
  const at = items.findIndex(item => item.id === openId)
  return at < 0 ? [items.slice()] : [items.slice(0, at + 1), items.slice(at + 1)].filter(part => part.length)
}

/** The open message and what you can do with it, as pictures and the app's text fields. */
function openBlock(elements: Pictured & WithInput, item: InboxItem, reply: InboxReply, now: number, width: number, actions: InboxActions,
                   hover: string, presses: Presses): RenderElement {
  const { Box, Input } = elements
  const act = (key: string) => run(actions, key)
  const message = messageSvg(width, item, reply, now, hover)
  const pieces: RenderElement[] = [
    clickable(elements, 'inbox-open-message', message.svg, `${itemAlt(item, now)}. ${detailLine(item, reply)}. ${(reply.full || item.body).slice(0, 600)}`,
      width, message.height, withAction(message.parts, act), presses),
  ]
  if (REPLY_SOURCES.has(item.source)) {
    if (reply.phase === 'editing') {
      pieces.push(<Input key="reply-edit" label={`Reply to ${item.from.name}`} value={replyText(reply)} submitLabel="use" autoFocus onSubmit={value => actions.submitEdit(value)} />)
      const cancel = rowOf(width, [['reply:cancel-edit', 'Cancel']], hover)
      pieces.push(clickable(elements, 'inbox-edit-row', cancel.svg, 'Cancel', width, cancel.height, cancel.parts.map(part => ({ ...part, onPress: actions.cancelEdit })), presses))
    } else {
      const box = replySvg(width, item, reply, hover)
      pieces.push(clickable(elements, 'inbox-reply', box.svg, `Reply to ${item.from.name}: ${reply.phase === 'drafting' ? 'drafting' : replyText(reply)}. Goes to ${reply.target}`,
        width, box.height, withAction(box.parts, act), presses))
      if (reply.improve !== 'off') {
        const panel = improveSvg(width, reply, hover)
        pieces.push(clickable(elements, 'inbox-improve', panel.svg, reply.improve === 'done' ? `Improved: ${reply.improved}. Use this, Improve again, Back` : `Improve: ${IMPROVE_PRESETS.join(', ')}`,
          width, panel.height, withAction(panel.parts, act), presses))
        if (reply.improve === 'choosing') {
          pieces.push(<Input key="reply-improve" label="Or say how to change it" value="" submitLabel="improve" onSubmit={value => actions.improveCustom(value)} />)
        }
      } else {
        const row = replyActionsSvg(width, item, reply, now, hover)
        pieces.push(clickable(elements, 'inbox-reply-actions', row.svg, reply.phase === 'countdown' ? `Sending to ${reply.target}. Undo` : 'Send reply, Improve, Edit, Save draft, Skip',
          width, row.height, withAction(row.parts, act), presses))
      }
    }
  } else if (item.source === 'jira') {
    const card = jiraSvg(width, reply, hover)
    pieces.push(clickable(elements, 'inbox-jira', card.svg, `Status ${reply.status}. Move to ${reply.choices.map(one => one.name).join(', ')}. Comment, Open in Jira, Done`,
      width, card.height, withAction(card.parts, act), presses))
    if (reply.isCommenting) {
      pieces.push(<Input key="jira-comment" label={`Comment on ${item.id.replace(/^jira:/, '')}`} value="" submitLabel="post" autoFocus onSubmit={value => actions.submitComment(value)} />)
      const cancel = rowOf(width, [['jira:cancel', 'Cancel']], hover)
      pieces.push(clickable(elements, 'inbox-comment-row', cancel.svg, 'Cancel', width, cancel.height, cancel.parts.map(part => ({ ...part, onPress: actions.cancelComment })), presses))
    }
  } else {
    const row = item.source === 'github' ? githubSvg(width, item, hover) : calendarSvg(width, item, hover)
    pieces.push(clickable(elements, 'inbox-actions', row.svg, item.source === 'github' ? 'Open on GitHub, Ask Claude, Done' : 'Join now, Open in Calendar, Done',
      width, row.height, withAction(row.parts, act), presses))
  }
  return <Box key={`open-${item.id}`} flexDirection="column" gap={1}>{pieces}</Box>
}

function rowOf(width: number, list: readonly [string, string][], hover: string) {
  return actionRow(width, list.map(([key, label]) => [key, label, 'outline'] as [string, string, 'outline']), hover)
}

export function inboxDesktop(elements: Pictured & WithInput, state: InboxState, drafted: ReadonlySet<string>, now: number, columns: number,
                             actions: InboxActions, hover: string, presses: Presses, hasAuto = false): RenderElement {
  const { Box, Input } = elements
  const width = widthOf(columns)
  const act = (key: string) => run(actions, key)
  const status = statusSvg(width, state, now)
  const unread = state.items.filter(item => !item.isRead).length
  const tools = toolbarSvg(width, unread, hasAuto, hover)
  const problems = problemsOf(state)
  const chips = filtersSvg(width, filters(state), state.filter, hover)
  const { needs, rest } = lists(state)
  const openId = state.reply?.id ?? ''
  const openItem = state.reply ? state.items.find(item => item.id === openId) ?? null : null
  const pieces: RenderElement[] = [
    clickable(elements, 'inbox-status', status.svg, `Right now: ${needs.length} need you, ${newToday(state, now)} new today`, width, status.height, [], presses),
    clickable(elements, 'inbox-tools', tools.svg, `${unread ? 'Mark all read, ' : ''}Sources${hasAuto ? ', Auto' : ''}`, width, tools.height, withAction(tools.parts, act), presses),
  ]
  if (problems.length) {
    const banners = bannersSvg(width, problems, hover)
    pieces.push(clickable(elements, 'inbox-banners', banners.svg, problems.map(one => `${one.source}: ${one.message}`).join('; '), width, banners.height,
      withAction(banners.parts, act), presses))
  }
  if (state.mode === 'demo') {
    const demo = demoSvg(width, hover)
    pieces.push(clickable(elements, 'inbox-demo', demo.svg, 'Demo: made-up messages. Use my accounts', width, demo.height, withAction(demo.parts, act), presses))
  }
  pieces.push(<Input key="inbox-search" label="Find a message or a person" value={state.query} submitLabel="find" onSubmit={value => actions.search(value)} />)
  pieces.push(clickable(elements, 'inbox-filters', chips.svg, filters(state).map(one => `${one.label} ${one.count}`).join(', '), width, chips.height,
    withAction(chips.parts, act), presses))
  const list = (name: string, title: string, right: string, items: readonly InboxItem[], markOf: (item: InboxItem) => RowMark) => {
    if (!items.length) return
    pieces.push(clickable(elements, `inbox-${name}-head`, sectionSvg(width, title, right), title, width, 26, [], presses))
    chunks(items, openId).forEach((part, index) => {
      const rows = rowsSvg(width, part, markOf, openId, hover)
      pieces.push(clickable(elements, `inbox-${name}-${index}`, rows.svg, part.map(item => itemAlt(item, now)).join('; '), width, rows.height,
        withAction(rows.parts, act), presses))
      if (openItem && state.reply && part[part.length - 1]?.id === openId) pieces.push(openBlock(elements, openItem, state.reply, now, width, actions, hover, presses))
    })
  }
  // At most 60 rows (each ~1,200 characters of picture), so the pane stays well under the engine's
  // 100,000-character limit for one tree; the open message always stays in the list.
  const cut = (items: readonly InboxItem[], max: number) => {
    const shown = items.slice(0, max)
    const open = items.find(item => item.id === openId)
    return open && !shown.includes(open) ? [...shown.slice(0, max - 1), open] : shown
  }
  const needsShown = cut(needs, NEEDS_ROWS)
  const restShown = cut(rest, LIST_ROWS - needsShown.length)
  list('needs', 'Needs you', String(needs.length), needsShown, item => (drafted.has(item.id) ? { text: 'Reply drafted', tone: 'teal' } : { text: 'Waiting', tone: 'amber' }))
  list('rest', 'Everything else', String(rest.length), restShown, item => ({ time: ago(item.receivedAt, now) }))
  const hidden = needs.length - needsShown.length + rest.length - restShown.length
  if (hidden > 0) {
    const more = emptySvg(width, `${hidden} more: use the filters or search to find them.`)
    pieces.push(clickable(elements, 'inbox-more', more.svg, `${hidden} more not shown`, width, more.height, [], presses))
  }
  if (!needs.length && !rest.length) {
    const empty = emptySvg(width, state.mode === 'starting' ? 'Connecting…' : state.query || state.filter !== 'all' ? 'Nothing matches.' : 'All caught up')
    pieces.push(clickable(elements, 'inbox-empty', empty.svg, 'All caught up', width, empty.height, [], presses))
  }
  return <Box flexDirection="column" gap={1}>{pieces}</Box>
}

/** The terminal: the same list and open message as text, every action a real Button. */
export function inboxText(elements: Basic & WithInput, state: InboxState, now: number, actions: InboxActions, hasAuto = false): RenderElement {
  const { Box, Button, Text, Input } = elements
  const { needs, rest } = lists(state)
  const { live, problem } = sourcesSummary(state)
  const openId = state.reply?.id ?? ''
  const reply = state.reply
  const openText = (item: InboxItem) => {
    if (!reply) return null
    const isReply = REPLY_SOURCES.has(item.source)
    return (
      <Box key={`open-${item.id}`} flexDirection="column" borderStyle="round" borderColor="success" paddingX={1}>
        <Text bold wrap="wrap">{item.title || item.from.name}</Text>
        <Text dimColor wrap="wrap">{detailLine(item, reply)}</Text>
        <Text wrap="wrap">{(reply.full || item.body).slice(0, 2_000)}</Text>
        {item.files.length ? <Text dimColor>{`📎 ${item.files.join(', ')}`}</Text> : null}
        {isReply ? (
          <Box flexDirection="column">
            <Text color="success" bold>{`● REPLY TO ${item.from.name.toUpperCase()}`}</Text>
            {reply.phase === 'editing' ? <Input key="reply-edit" label="Your reply" value={replyText(reply)} submitLabel="use" autoFocus onSubmit={value => actions.submitEdit(value)} />
              : <Text wrap="wrap">{reply.phase === 'drafting' ? 'Drafting three replies…' : replyText(reply) ? `“${replyText(reply)}”` : reply.error || 'No reply yet.'}</Text>}
            {reply.target ? <Text dimColor>{`Goes to ${reply.target}`}</Text> : null}
            {reply.note ? <Text color="warning">{reply.note}</Text> : null}
            {reply.drafts.short && !['countdown', 'sending', 'sent'].includes(reply.phase) ? (
              <Box flexDirection="row" gap={1} flexWrap="wrap">
                {(['short', 'detailed', 'ask'] as const).map(option => (
                  <Button key={`reply:opt:${option}`} plain label={`${reply.option === option && !reply.edited ? '●' : '○'} ${option === 'ask' ? reply.thirdLabel : option === 'short' ? 'Short' : 'Detailed'}`}
                          onPress={() => actions.option(option)} />
                ))}
                {item.source === 'gmail' ? <Button key="reply:all" plain label={`${reply.replyAll ? '☑' : '☐'} Reply all`} onPress={actions.replyAll} /> : null}
              </Box>
            ) : null}
            {reply.improve === 'done' ? (
              <Box flexDirection="column">
                <Text wrap="wrap">{`Improved: “${reply.improved}”`}</Text>
                <Box flexDirection="row" gap={1}>
                  <Button key="reply:improve:use" label="Use this" onPress={actions.improveUse} />
                  <Button key="reply:improve:back" label="Back" onPress={actions.improveBack} />
                </Box>
              </Box>
            ) : reply.improve !== 'off' ? (
              <Box flexDirection="column">
                <Box flexDirection="row" gap={1} flexWrap="wrap">
                  {IMPROVE_PRESETS.map((preset, index) => <Button key={`reply:improve:${index}`} plain label={preset} onPress={() => actions.improvePreset(index)} />)}
                  <Button key="reply:improve:back" plain label="Back" onPress={actions.improveBack} />
                </Box>
                <Input key="reply-improve" label="Or say how to change it" value="" submitLabel="improve" onSubmit={value => actions.improveCustom(value)} />
              </Box>
            ) : reply.phase === 'countdown' ? (
              <Button key="reply:undo" label={`Undo (sending in ${Math.max(1, Math.ceil((reply.sendAt - now) / 1000))} s)`} autoFocus onPress={actions.undo} />
            ) : reply.phase === 'sent' ? (
              <Box flexDirection="row" gap={1}>
                <Text color="success">✓ Sent as you</Text>
                {reply.undo === 'slack_delete' ? <Button key="reply:delete" label="Delete from Slack" onPress={actions.deleteSent} /> : null}
                <Button key="reply:close" label="Done" autoFocus onPress={actions.close} />
              </Box>
            ) : reply.phase === 'failed' ? (
              <Box flexDirection="column">
                <Text color="error" wrap="wrap">{reply.error}</Text>
                <Box flexDirection="row" gap={1}>
                  {reply.failCode === 'original_edited' ? <Button key="reply:anyway" label="I re-read it · send" onPress={actions.sendAnyway} /> : null}
                  <Button key="reply:back" label="Back to reply" onPress={actions.backToReply} />
                </Box>
              </Box>
            ) : reply.phase !== 'editing' ? (
              <Box flexDirection="row" gap={1} flexWrap="wrap">
                {canSend(reply) ? <Button key="reply:send" label="Send reply" hotkey="1" onPress={actions.send} /> : null}
                {replyText(reply) && !item.isExcluded ? <Button key="reply:improve" label="Improve" hotkey="2" onPress={actions.improve} /> : null}
                <Button key="reply:edit" label="Edit" hotkey="3" onPress={actions.startEdit} />
                {replyText(reply) ? <Button key="reply:draft" label="Save draft" hotkey="4" onPress={actions.saveDraft} /> : null}
                <Button key="reply:skip" label="Skip" hotkey="5" onPress={actions.skip} />
              </Box>
            ) : <Button key="reply:cancel-edit" plain label="Cancel" onPress={actions.cancelEdit} />}
          </Box>
        ) : item.source === 'jira' ? (
          <Box flexDirection="column">
            <Text>{`Status: ${reply.status || '…'}`}</Text>
            <Box flexDirection="row" gap={1} flexWrap="wrap">
              {reply.choices.filter(one => one.name !== reply.status).map(one => <Button key={`jira:move:${one.id}`} plain label={`→ ${one.name}`} onPress={() => actions.move(one.id)} />)}
            </Box>
            {reply.isCommenting ? <Input key="jira-comment" label="Comment" value="" submitLabel="post" autoFocus onSubmit={value => actions.submitComment(value)} /> : null}
            <Box flexDirection="row" gap={1}>
              <Button key="jira:comment" label="Comment" onPress={actions.comment} />
              <Button key="inbox:link" label="Open in Jira" onPress={actions.link} />
              <Button key="reply:close" label="Done" onPress={actions.close} />
            </Box>
          </Box>
        ) : (
          <Box flexDirection="row" gap={1}>
            {item.source === 'calendar' ? <Button key="cal:join" label="Join now" onPress={actions.join} /> : <Button key="gh:review" label="Ask Claude to review" onPress={actions.askReview} />}
            <Button key="inbox:link" label="Open" onPress={actions.link} />
            <Button key="reply:close" label="Done" onPress={actions.close} />
          </Box>
        )}
      </Box>
    )
  }
  const row = (item: InboxItem, mark: string) => (
    <Box key={item.id} flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Button key={`inbox:open:${item.id}`} plain label={`${item.id === openId ? '▾' : '›'} ${BADGE[item.source].padEnd(5)} ${item.from.name}`} onPress={() => actions.open(item.id)} />
        <Text dimColor={item.isRead || item.level === 'quiet'} wrap="truncate-end">{rowText(item).what}</Text>
        <Text dimColor>{mark}</Text>
      </Box>
      {item.id === openId ? openText(item) : null}
    </Box>
  )
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column" borderStyle="round" paddingX={1}>
        <Text color="warning" bold>● RIGHT NOW</Text>
        <Text bold>{needs.length ? `${needs.length} need${needs.length === 1 ? 's' : ''} you` : 'Nothing needs you'}</Text>
        <Text dimColor>{`${newToday(state, now)} new today · ${live} source${live === 1 ? '' : 's'} live · $${state.costToday.toFixed(2)} today on Haiku`}</Text>
        {problem ? <Text color="warning">{`${SOURCE_NAME[problem.source as keyof typeof SOURCE_NAME] ?? problem.source}: ${problem.message}`}</Text> : null}
      </Box>
      <Box flexDirection="row" gap={1}>
        {state.items.some(item => !item.isRead) ? <Button key="inbox:allread" plain label="Mark all read" onPress={actions.allRead} /> : null}
        <Button key="inbox:sources" plain label="⚙ Sources" onPress={actions.sources} />
        {hasAuto ? <Button key="auto:open" plain label="ϟ Auto" onPress={actions.openAuto} /> : null}
        {state.mode === 'demo' ? <Button key="inbox:demo-off" plain label="Demo · use my accounts" onPress={actions.demoOff} /> : null}
      </Box>
      <Input key="inbox-search" label="Find a message or a person" value={state.query} submitLabel="find" onSubmit={value => actions.search(value)} />
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {filters(state).map(one => (
          <Button key={`inbox:filter:${one.key}`} plain label={`${state.filter === one.key ? '●' : '○'} ${one.label} ${one.count}`} onPress={() => actions.filter(one.key)} />
        ))}
      </Box>
      <Text bold>{`NEEDS YOU · ${needs.length}`}</Text>
      {needs.length ? needs.slice(0, NEEDS_ROWS).map(item => row(item, 'Waiting')) : <Text dimColor>Nothing waiting on you.</Text>}
      <Text bold>{`EVERYTHING ELSE · ${rest.length}`}</Text>
      {rest.length ? rest.slice(0, 60).map(item => row(item, ago(item.receivedAt, now))) : <Text dimColor>All caught up.</Text>}
    </Box>
  )
}
