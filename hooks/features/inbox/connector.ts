// What Claude's connectors send back, read as plain data: Gmail's threads (for drafting and the send
// check), and Jira's issues and transitions (checked against the live Atlassian connector, 2026-10-12).
// register.tsx makes the `$.mcp.call`s. Every field is read in both spellings (`thread_id`/`threadId`).
// Ported from v1's hooks/lib/gmailConnector.ts.

import type { ThreadMessage } from './drafts.ts'
import type { InboxItem } from './model.ts'

export const CONNECTORS_URL = 'https://claude.ai/settings/connectors'

const camel = (name: string) => name.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase())

/** The first of `names` (either spelling) that has a value. */
export function field(value: unknown, ...names: string[]): unknown {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  for (const name of names) {
    for (const key of [name, camel(name)]) {
      const found = record[key]
      if (found !== undefined && found !== null && found !== '') return found
    }
  }
  return undefined
}

type McpResult = { content?: { type: string; text?: string }[]; structuredContent?: unknown; isError?: boolean }

/** An MCP result's JSON: structured content, else the text blocks parsed, else `{ text }`. */
export function payload(result: unknown): unknown {
  const value = (result ?? {}) as McpResult
  if (value.structuredContent && typeof value.structuredContent === 'object') return value.structuredContent
  const text = (value.content ?? []).filter(block => block.type === 'text').map(block => block.text ?? '').join('')
  if (!text.trim()) return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    return { text }
  }
}

/** A failed MCP result's words, short. */
export function errorText(result: unknown): string {
  const value = (result ?? {}) as McpResult
  return (value.content ?? []).filter(block => block.type === 'text').map(block => block.text ?? '').join(' ').trim().slice(0, 300)
}

export const isError = (result: unknown) => !!(result as McpResult | null)?.isError

// ---- Gmail -----------------------------------------------------------------------------------------

function messagesOf(thread: unknown): Record<string, unknown>[] {
  const list = field(thread, 'messages', 'related_messages')
  return Array.isArray(list) ? list.filter((one): one is Record<string, unknown> => !!one && typeof one === 'object') : []
}

function sender(value: unknown): { name: string; email: string } {
  if (value && typeof value === 'object') {
    const email = String(field(value, 'email', 'email_address', 'address') ?? '')
    return { name: String(field(value, 'name', 'display_name') ?? email), email }
  }
  const text = String(value ?? '')
  const match = /^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/.exec(text)
  return match ? { name: (match[1] ?? '').trim() || (match[2] ?? ''), email: match[2] ?? '' } : { name: text, email: text }
}

function when(value: unknown): number {
  if (typeof value === 'number') return value > 1e12 ? value : value * 1000
  const text = String(value ?? '')
  if (/^\d+$/.test(text)) return Number(text) > 1e12 ? Number(text) : Number(text) * 1000
  const parsed = Date.parse(text)
  return Number.isNaN(parsed) ? 0 : parsed
}

/** A get_thread result → the conversation, oldest first (the last 10 messages). */
export function threadMessages(data: unknown, me: string): ThreadMessage[] {
  const thread = field(data, 'thread') ?? data
  return messagesOf(thread)
    .map(message => {
      const from = sender(field(message, 'sender', 'from'))
      const isMe = !!me && from.email.toLowerCase() === me.toLowerCase()
      const at = when(field(message, 'date', 'internal_date'))
      return { from: isMe ? 'you' : from.name || from.email, isMe, text: String(field(message, 'plaintext_body', 'body', 'snippet') ?? '').slice(0, 8_000), at: at ? new Date(at).toISOString() : '' }
    })
    .filter(message => message.text)
    .sort((a, b) => (a.at < b.at ? -1 : 1))
    .slice(-10)
}

/** Whether the message is still in its thread and not in the trash (it may be deleted since). */
export function threadHasMessage(data: unknown, messageId: string): boolean {
  const thread = field(data, 'thread') ?? data
  return messagesOf(thread).some(message => {
    const labels = field(message, 'label_ids')
    const isTrashed = Array.isArray(labels) && labels.includes('TRASH')
    return String(field(message, 'id', 'message_id') ?? '') === messageId && !isTrashed
  })
}

/** `gmail:<id>` → the Gmail message id. */
export const gmailId = (item: InboxItem) => (item.id.startsWith('gmail:') ? item.id.slice('gmail:'.length) : item.id)

export const replyArgs = (messageId: string, text: string, replyAll: boolean) => ({ messageId, body: text, replyAll })
export const draftArgs = (messageId: string, text: string) => ({ replyToMessageId: messageId, body: text })

// ---- Jira ------------------------------------------------------------------------------------------

/** `jira:ACME-2919` → `ACME-2919`. */
export const jiraKey = (item: InboxItem) => (item.id.startsWith('jira:') ? item.id.slice('jira:'.length) : item.from.handle)

export type JiraIssue = { status: string; priority: string; text: string; comments: { from: string; text: string }[] }

/** getJiraIssue → status, priority, the description and the last comments (as markdown). */
export function jiraIssueOf(data: unknown): JiraIssue | null {
  const nodes = field(field(data, 'issues'), 'nodes')
  const issue = Array.isArray(nodes) ? nodes[0] : field(data, 'fields') ? data : null
  const fields = field(issue, 'fields')
  if (!fields) return null
  const comments = field(field(fields, 'comment'), 'comments')
  return {
    status: String(field(field(fields, 'status'), 'name') ?? ''),
    priority: String(field(field(fields, 'priority'), 'name') ?? ''),
    text: cleanJira(String(field(fields, 'description') ?? '')),
    comments: (Array.isArray(comments) ? comments : []).slice(-3).map(one => ({
      from: String(field(field(one, 'author'), 'display_name') ?? 'Someone'), text: cleanJira(String(field(one, 'body') ?? '')).slice(0, 600),
    })),
  }
}

/** Jira's markdown without images (blob links the pane can't show) and long blank runs. */
function cleanJira(text: string): string {
  return text.replace(/!\[[^\]]*]\([^)]*\)/g, '[image]').replace(/‌/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 6_000)
}

/** getTransitionsForJiraIssue → the statuses it can move to, by name. */
export function transitionsOf(data: unknown): { id: string; name: string }[] {
  const list = field(data, 'transitions')
  return (Array.isArray(list) ? list : [])
    .filter(one => field(one, 'is_available') !== false)
    .map(one => ({ id: String(field(one, 'id') ?? ''), name: String(field(one, 'name') ?? '') }))
    .filter(one => one.id && one.name)
    .slice(0, 12)
}
