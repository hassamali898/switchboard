"""Demo feed: the fictional items from the approved design, for trying the UI with no tokens.

Demo items carry meta.demo = True; the send path never touches the network for them.
"""

from __future__ import annotations

import time
from typing import Iterator

from .items import Item, Person, Thread, ts_to_iso


def _item(n: int, source: str, kind: str, name: str, title: str, body: str, minutes_ago: float,
          **meta) -> Item:
    ts = time.time() - minutes_ago * 60
    handle = name.lower().replace(" ", ".")
    sender = Person(name=name, handle=f"U{n:04d}" if source == "slack" else f"{handle}@example.com",
                    email=f"{handle}@example.com")
    item_id = f"{source}:DEMO:{n}"
    base_meta = {"demo": True, "channel": f"DDEMO{n}", "ts": f"{ts:.6f}", "thread_ts": "", "labels": ["INBOX"],
                 "subject": title, "thread_id": f"t{n}", "message_id": f"<demo{n}@example.com>"}
    base_meta.update(meta)
    return Item(id=item_id, source=source, kind=kind, sender=sender, title=title, body=body,
                url="", thread=Thread(id=f"demo:{n}"), received_at=ts_to_iso(ts), meta=base_meta,
                via="demo")


def backlog() -> list[Item]:
    return [
        _item(1, "gmail", "mail", "GitHub Changelog", "Newsletter: what's new this week",
              "New in Actions, Copilot and Codespaces this week.", 120,
              labels=["INBOX", "CATEGORY_UPDATES"]),
        _item(2, "slack", "mention", "Bilal Ahmed", "@alex deploy is blocked on your review",
              "@alex deploy is blocked on your review", 31, channel="CDEMO2", channel_name="acme-devs"),
        _item(3, "gmail", "mail", "Sara Khan", "Q4 roadmap review, slides attached",
              "Hi Alex,\n\nAttached are the Q4 roadmap slides. Could you look at the auth section "
              "before Thursday's review?\n\nThanks,\nSara", 14, files=["Q4-roadmap.pdf"]),
    ]


def live() -> Iterator[tuple[float, Item]]:
    """(delay seconds, item) pairs that arrive after the backlog."""
    yield 3, _item(4, "slack", "dm", "Ahmed Raza", "Can you review PR #482 before 5pm?",
                   "Can you review PR #482 before 5pm? It's the session store migration.", 0)
    yield 20, _item(5, "slack", "dm", "Bilal Ahmed", "Lunch at 1?", "Lunch at 1? Usual place.", 0)
    yield from connected()


def connected() -> Iterator[tuple[float, Item]]:
    """Dummy GitHub, Jira and Calendar items: what the connectors would have sent (for testing only)."""
    from .items import Thread as _Thread
    from .items import Person as _Person

    now = time.time()
    review = Item(id="github:DEMO:9", source="github", kind="review_request",
                  sender=_Person(name="acme/acme-api", handle="acme/acme-api"), title="Add session store migration",
                  body="acme/acme-api · review requested", url="https://github.com/acme/acme-api/pull/482",
                  thread=_Thread(id="demo:9"), level="high", received_at=ts_to_iso(now - 300), via="demo",
                  meta={"demo": True, "repo": "acme/acme-api", "labels": []})
    jira = Item(id="jira:DEMO:ACME-1290", source="jira", kind="assigned",
                sender=_Person(name="ACME-1290", handle="ACME-1290"), title="Safari login loop",
                body="ACME-1290 · In Progress", url="https://acme.atlassian.net/browse/ACME-1290",
                thread=_Thread(id="demo:10"), level="normal", received_at=ts_to_iso(now - 600), via="demo",
                meta={"demo": True, "status": "In Progress", "labels": []})
    start = now + 50 * 60
    meeting = Item(id="calendar:DEMO:standup", source="calendar", kind="meeting",
                   sender=_Person(name="Bilal Ahmed", handle="bilal.ahmed@example.com", email="bilal.ahmed@example.com"),
                   title="Sprint planning", body="Plan the next sprint: carry-overs, the session store migration, Safari login loop.",
                   url="https://calendar.google.com/calendar/r", thread=_Thread(id="demo:11"), level="normal",
                   received_at=ts_to_iso(now - 900), via="demo",
                   meta={"demo": True, "starts_at": ts_to_iso(start), "ends_at": ts_to_iso(start + 1800),
                         "join_url": "https://meet.google.com/abc-defg-hij",
                         "attendees": ["Bilal Ahmed", "Ahmed Raza", "Sara Khan", "Zara Malik", "Omar Farooq"]})
    yield 40, review
    yield 60, jira
    yield 70, meeting
