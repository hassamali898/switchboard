// Meetings (phase 8): when the meeting card fires. Pure: register.tsx keeps the list, the timers and the card.
// The stages for each meeting: a lead time before it (5 minutes by default), then 1 minute before, then the
// start. Timers are local to every window, so the card still fires when the Inbox session has closed.

export const FINAL_MS = 60_000

export type Meeting = {
  id: string
  title: string
  startsAt: number
  endsAt: number
  joinUrl: string
  attendees: string[]
  isDeclined: boolean
}

export type Stage = 'lead' | 'final' | 'start'
export type Alarm = { at: number; stage: Stage; meetingId: string }

/** Only https join links are offered; anything else gets no Join button. */
export const joinable = (url: string) => url.startsWith('https://')

/** The times a meeting's card fires, in order (passed ones included: `dueCard` picks what is due and not yet shown). */
export function alarmsOf(meeting: Meeting, leadMin: number, now: number): Alarm[] {
  if (meeting.isDeclined) return []
  const stages: Alarm[] = [
    { at: meeting.startsAt - leadMin * 60_000, stage: 'lead', meetingId: meeting.id },
    { at: meeting.startsAt - FINAL_MS, stage: 'final', meetingId: meeting.id },
    { at: meeting.startsAt, stage: 'start', meetingId: meeting.id },
  ]
  // A meeting already under way when we notice shows its card once, not the stages it missed.
  if (meeting.startsAt <= now) return meeting.endsAt > now ? [{ at: now, stage: 'start', meetingId: meeting.id }] : []
  // Stages already passed stay: a 5-minute warning for a meeting 4 minutes away is still due.
  return stages.sort((a, b) => a.at - b.at)
}

/** Two meetings at the same time are one card with a Join for each (BUILD_PLAN.md P8 edge cases). */
export function dueCard(meetings: readonly Meeting[], leadMin: number, now: number, shown: ReadonlySet<string>): { meetings: Meeting[]; stage: Stage } | null {
  const live = meetings.filter(meeting => !meeting.isDeclined && meeting.endsAt > now)
  const due = live.flatMap(meeting => alarmsOf(meeting, leadMin, now).filter(alarm => alarm.at <= now))
  const fresh = due.filter(alarm => !shown.has(`${alarm.meetingId}:${alarm.stage}`))
  if (!fresh.length) return null
  const latest = fresh.sort((a, b) => b.at - a.at)[0]!
  const stage = latest.stage
  const sameTime = live.filter(meeting => meeting.startsAt === live.find(one => one.id === latest.meetingId)?.startsAt)
  return { meetings: sameTime, stage }
}

/** "in 4 min", "now", "started 2 min ago". */
export function countdown(meeting: Meeting, now: number): string {
  const minutes = Math.round((meeting.startsAt - now) / 60_000)
  if (minutes > 0) return `in ${minutes} min`
  if (minutes === 0) return 'now'
  return `started ${Math.abs(minutes)} min ago`
}

/**
 * Merges the list the connector gave us (the next `spanMs`) into the stored one. A moved meeting replaces
 * its old time; one no longer listed in that span was cancelled or deleted, and goes. "Not going" here
 * stays, whatever the calendar still says.
 */
export function withMeetings(stored: readonly Meeting[], fresh: readonly Meeting[], now: number, spanMs = 86_400_000): Meeting[] {
  const listed = new Set(fresh.map(meeting => meeting.id))
  const byId = new Map(stored.filter(meeting => listed.has(meeting.id) || meeting.startsAt < now || meeting.startsAt > now + spanMs)
    .map(meeting => [meeting.id, meeting]))
  for (const meeting of fresh) byId.set(meeting.id, { ...meeting, isDeclined: meeting.isDeclined || !!byId.get(meeting.id)?.isDeclined })
  return [...byId.values()].filter(meeting => meeting.endsAt > now - 60 * 60_000).sort((a, b) => a.startsAt - b.startsAt)
}
