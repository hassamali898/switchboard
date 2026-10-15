// Meetings (phase 8): the stages fire 5 minutes, 1 minute and at the start; declined and past meetings
// never fire; two at the same time are one card; Join needs https.

import { describe, expect, test } from 'claude-code/testing'
import { buttonsSvg, cardSvg, compactSvg, whenText } from '../../hooks/features/meeting/pictures.ts'
import { alarmsOf, countdown, dueCard, joinable, withMeetings, type Meeting } from '../../hooks/features/meeting/model.ts'

const T = Date.parse('2026-10-12T10:00:00Z')
const meeting = (id: string, startsAt: number, extra: Partial<Meeting> = {}): Meeting =>
  ({ id, title: `Meeting ${id}`, startsAt, endsAt: startsAt + 30 * 60_000, joinUrl: 'https://meet.example/abc', attendees: [], isDeclined: false, ...extra })

describe('meeting timers', () => {
  test('lead time, then one minute before, then the start', async () => {
    const m = meeting('a', T + 10 * 60_000)
    expect(alarmsOf(m, 5, T).map(alarm => alarm.stage)).toEqual(['lead', 'final', 'start'])
    expect(alarmsOf(m, 5, T)[0]!.at).toBe(T + 5 * 60_000)
  })

  test('declined meetings have no timers; one under way shows its card once', async () => {
    expect(alarmsOf(meeting('d', T + 60_000, { isDeclined: true }), 5, T)).toEqual([])
    const running = alarmsOf(meeting('r', T - 2 * 60_000), 5, T)
    expect(running.map(alarm => alarm.stage)).toEqual(['start'])
    expect(alarmsOf(meeting('o', T - 60 * 60_000, { endsAt: T - 1 }), 5, T)).toEqual([])
  })

  test('the card: the latest due stage, once per stage, and two meetings at one time share it', async () => {
    const two = [meeting('a', T + 4 * 60_000), meeting('b', T + 4 * 60_000)]
    const first = dueCard(two, 5, T + 1, new Set())
    expect(first?.stage).toBe('lead')
    expect(first?.meetings.map(one => one.id)).toEqual(['a', 'b'])
    expect(dueCard(two, 5, T + 1, new Set(['a:lead', 'b:lead']))).toBeNull()
    expect(dueCard(two, 5, T + 3 * 60_000, new Set(['a:lead', 'b:lead']))?.stage).toBe('final')
  })

  test('a moved meeting replaces its old time; Join needs https; countdown text', async () => {
    const stored = [meeting('a', T + 60 * 60_000)]
    const moved = withMeetings(stored, [meeting('a', T + 2 * 60 * 60_000)], T)
    expect(moved).toHaveLength(1)
    expect(moved[0]!.startsAt).toBe(T + 2 * 60 * 60_000)
    expect(joinable('https://meet.example/abc')).toBe(true)
    expect(joinable('http://insecure.example')).toBe(false)
    expect([countdown(meeting('c', T + 4 * 60_000), T), countdown(meeting('n', T), T), countdown(meeting('p', T - 2 * 60_000), T)])
      .toEqual(['in 4 min', 'now', 'started 2 min ago'])
  })

  test('the card: ring time, "starts in 4 min", Join only for https, the compact card fits 12 rows', async () => {
    const m = meeting('a', T + 252_000, { attendees: ['Bilal Ahmed', 'Ahmed Raza', 'Sara Khan', 'Zara Malik', 'X', 'Y', 'Z'] })
    expect(whenText(m, T)).toBe('starts in 4 min')
    expect(cardSvg(760, [m], T, 300_000).svg).toContain('4:12')
    expect(buttonsSvg(760, [m], '').parts.map(part => part.key)).toEqual(['meeting:join:a', 'meeting:later:1', 'meeting:later:3', 'meeting:dismiss'])
    expect(buttonsSvg(760, [{ ...m, joinUrl: 'http://x' }], '').parts.map(part => part.key)).toEqual(['meeting:later:1', 'meeting:later:3', 'meeting:dismiss'])
    expect(compactSvg(760, [m], T, 300_000, '').height).toBeLessThan(12 * 19)
  })
})

describe('the shared list', () => {
  test('a meeting no longer listed was cancelled and goes; "Not going" here stays after the next check', async () => {
    const stored = [meeting('a', T + 60 * 60_000, { isDeclined: true }), meeting('b', T + 2 * 60 * 60_000), meeting('far', T + 3 * 86_400_000)]
    const fresh = [meeting('a', T + 60 * 60_000)]
    const merged = withMeetings(stored, fresh, T)
    expect(merged.map(one => one.id)).toEqual(['a', 'far'])
    expect(merged[0]!.isDeclined).toBe(true)
  })
})

