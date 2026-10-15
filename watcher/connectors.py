"""Calendar, GitHub and Jira results from Claude's connectors → inbox items.

Pure functions: each takes one record as the connector returns it and gives an Item, or None when
it isn't something to show (declined, all-day, a bot, a status you don't watch). Field names are read
in snake and camel case, as the connectors use both. Links are kept only when they are https.
"""

from __future__ import annotations

import re

from datetime import datetime, timezone
from typing import Any, Optional

from .items import Item, Person, Thread


def field(obj: Any, *names: str, default: Any = None) -> Any:
    if not isinstance(obj, dict):
        return default
    for name in names:
        for key in (name, _camel(name)):
            value = obj.get(key)
            if value not in (None, ""):
                return value
    return default


def _camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(part.title() for part in rest)


def https(url: Any) -> str:
    text = str(url or "").strip()
    return text if text.startswith("https://") else ""


def _epoch(value: Any) -> float:
    if isinstance(value, (int, float)):
        return float(value) / (1000 if value > 1e12 else 1)
    text = str(value or "").strip()
    if not text:
        return 0.0
    # Jira writes "+0000"; Python 3.10's fromisoformat wants "+00:00".
    text = re.sub(r"([+-]\d{2})(\d{2})$", r"\1:\2", text.replace("Z", "+00:00"))
    try:
        return datetime.fromisoformat(text).timestamp()
    except ValueError:
        return 0.0


def iso(epoch: float) -> str:
    """UTC ISO time; "" when unknown or out of range."""
    try:
        return datetime.fromtimestamp(epoch, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if epoch else ""
    except (OverflowError, OSError, ValueError):
        return ""


def received(epoch: float) -> str:
    """An item's time: now when the record has none, so the 14-day archive never takes it at once."""
    return iso(epoch) or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---- Calendar ---------------------------------------------------------------------------------------

def _join_link(event: dict[str, Any]) -> str:
    direct = https(field(event, "conference_url", "hangout_link", "meet_link", "join_url"))
    if direct:
        return direct
    entry = field(event, "conference_data", default={}) or {}
    video = https(field(field(entry, "video_entry_point", default={}) or {}, "uri"))
    if video:
        return video
    for point in field(entry, "entry_points", default=[]) or []:
        link = https(field(point, "uri"))
        if link:
            return link
    return ""


def calendar_item(event: dict[str, Any], me: str = "") -> Optional[Item]:
    """A timed event you haven't declined. All-day events and cancelled ones are never shown."""
    event_id = str(field(event, "id", default="")).strip()
    start_raw = field(event, "start", default={}) or {}
    end_raw = field(event, "end", default={}) or {}
    start = field(start_raw, "date_time", "dateTime", default="")
    if not event_id or not start:  # all-day events carry only a date
        return None
    attendees = field(event, "attendees", default=[]) or []
    # You: the attendee Google marks `self` (checked against the live connector), else your address.
    my_status = next((field(a, "response_status", default="") for a in attendees if isinstance(a, dict)
                      and (a.get("self") is True or (me and str(field(a, "email", default="")).lower() == me.lower()))), "")
    if my_status == "declined" or str(field(event, "status", default="")) == "cancelled":
        return None
    people = [field(a, "display_name", "email", default="") for a in attendees if isinstance(a, dict) and a.get("self") is not True]
    people = [name for name in people if name][:12]
    title = str(field(event, "summary", default="")).strip() or "(no title)"
    starts = _epoch(start)
    ends = _epoch(field(end_raw, "date_time", "dateTime", default=""))
    return Item(
        id=f"calendar:{event_id}", source="calendar", kind="meeting",
        sender=Person(name=title[:80]), title=title,
        body=f"{len(people)} attendee{'s' if len(people) != 1 else ''}" + (f": {', '.join(people)}" if people else ""),
        url=https(field(event, "html_link", "htmlLink")),
        # The meeting card alerts for meetings; the row itself waits in "Everything else".
        received_at=received(starts), level="normal",
        via="connector",
        meta={"starts_at": iso(starts), "ends_at": iso(ends), "join_url": _join_link(event), "attendees": people,
              "timezone": str(field(start_raw, "time_zone", "timeZone", default=""))},
    )


# ---- GitHub -----------------------------------------------------------------------------------------

# The reasons GitHub gives a notification, as the items they become.
GITHUB_KINDS = {"review_requested": "review_request", "mention": "mention", "team_mention": "mention",
                "ci_activity": "ci_failed", "comment": "comment", "assign": "assigned", "author": "comment"}
GITHUB_LEVEL = {"review_request": "high", "mention": "high", "ci_failed": "normal", "assigned": "normal", "comment": "normal"}


def github_item(note: dict[str, Any]) -> Optional[Item]:
    """One GitHub notification. Reasons we don't watch (subscribed, state changes) are not shown."""
    reason = str(field(note, "reason", default=""))
    kind = GITHUB_KINDS.get(reason)
    if not kind:
        return None
    subject = field(note, "subject", default={}) or {}
    repo = str(field((field(note, "repository", default={}) or {}), "full_name", "fullName", default=""))
    title = str(field(subject, "title", default="")).strip() or "(untitled)"
    thread_id = str(field(note, "id", default="")).strip()
    if not thread_id:
        return None
    if kind == "ci_failed" and "fail" not in title.lower():
        return None  # a CI run that passed isn't news
    return Item(
        id=f"github:{thread_id}", source="github", kind=kind,
        sender=Person(name=repo or "GitHub", handle=repo),
        title=title, body=f"{repo} · {reason.replace('_', ' ')}",
        url=https(field(note, "html_url", "htmlUrl")),
        thread=Thread(id=thread_id), level=GITHUB_LEVEL[kind],  # type: ignore[arg-type]
        received_at=received(_epoch(field(note, "updated_at", "updatedAt"))), via="connector",
        meta={"repo": repo, "subject_url": str(field(subject, "url", default=""))},
    )


# ---- Jira -------------------------------------------------------------------------------------------

def jira_item(issue: dict[str, Any], me: str = "", assigned: bool = False) -> Optional[Item]:
    """An issue assigned to you (or mentioning you). Done issues aren't shown.

    `assigned`: the search itself asked for your issues (Atlassian's connector, `assignee = currentUser()`)."""
    key = str(field(issue, "key", default="")).strip()
    fields = field(issue, "fields", default={}) or {}
    if not key:
        return None
    status_field = field(fields, "status", default={}) or {}
    status = str(field(status_field, "name", default=""))
    category = str(field(field(status_field, "statusCategory", default={}) or {}, "key", default=""))
    if status.lower() in ("done", "closed", "resolved") or category == "done":
        return None
    assignee = field(fields, "assignee", default={}) or {}
    assignee_name = str(field(assignee, "display_name", "displayName", "name", default=""))
    is_mine = assigned or (bool(me) and me.lower() in (assignee_name.lower(), str(field(assignee, "email_address", "emailAddress", default="")).lower()))
    kind = "assigned" if is_mine else "comment"
    summary = str(field(fields, "summary", default="")).strip() or key
    reporter = field(fields, "reporter", default={}) or {}
    reporter_name = str(field(reporter, "display_name", "displayName", default="")).strip()
    return Item(
        id=f"jira:{key}", source="jira", kind=kind,
        sender=Person(name=reporter_name or key, handle=key),
        title=summary, body=f"{key} · {status or 'no status'}",
        url=https(field(issue, "url", "browse_url", "browseUrl", "webUrl")),
        level="normal", received_at=received(_epoch(field(fields, "updated", default=""))), via="connector",
        meta={"status": status, "assignee": assignee_name},
    )


# ---- Slack, through Claude's connector -------------------------------------------------------------
# slack_search_public_and_private answers in Markdown, one "### Result" block per message (checked against
# the live connector, 2026-10-12): Channel, Participants, From (with [BOT]), Time, Message_ts, Permalink, Text.

_SLACK_LINE = re.compile(r"^(Channel|From|Message_ts|Permalink|Time):\s*(.*)$")


def slack_results(markdown: str) -> list[dict[str, str]]:
    """The search's Markdown → one record per message (never trusted beyond these fields)."""
    records: list[dict[str, str]] = []
    for block in re.split(r"^### Result \d+ of \d+\s*$", markdown, flags=re.M)[1:]:
        record: dict[str, str] = {}
        lines = block.strip().split("\n")
        for index, line in enumerate(lines):
            if line.startswith("Text:"):
                text = "\n".join([line[5:].strip(), *lines[index + 1:]]).split("\n---")[0].strip()
                record["text"] = text[:8000]
                break
            match = _SLACK_LINE.match(line.strip())
            if match:
                record[match.group(1).lower()] = match.group(2).strip()
        if record.get("message_ts"):
            records.append(record)
    return records


def slack_item(record: dict[str, str], me_id: str, kind: str) -> Optional[Item]:
    """A DM or a mention for you. Bots and your own messages are skipped."""
    sender = record.get("from", "")
    if "[BOT]" in sender:
        return None
    sender_id = (re.search(r"\(ID: (U\w+)\)", sender) or [None, ""])[1]
    if me_id and sender_id == me_id:
        return None
    name = re.sub(r"\s*<[^>]*>|\s*\(ID:[^)]*\)|\s*\[BOT\]", "", sender).strip() or "Someone"
    channel = record.get("channel", "")
    channel_id = (re.search(r"\(ID: (\w+)\)", channel) or [None, ""])[1]
    channel_name = channel.split(" (ID:")[0].lstrip("#").strip()
    ts = record.get("message_ts", "")
    text = re.sub(r"<@\w+\|([^>]+)>", r"@\1", record.get("text", ""))
    text = re.sub(r"<(https?://[^|>]+)\|([^>]+)>", r"\2 (\1)", text)
    if not ts or not channel_id or not text.strip():
        return None
    try:
        when = float(ts)
    except ValueError:
        return None
    is_dm = channel.startswith("DM")
    permalink = re.search(r"\((https://[^)]+)\)", record.get("permalink", "").replace("\\/", "/"))
    return Item(
        id=f"slack:{channel_id}:{ts}", source="slack", kind="dm" if is_dm else kind,
        sender=Person(name=name, handle=sender_id), title=text.split("\n")[0][:140], body=text,
        url=permalink.group(1) if permalink else "", received_at=received(when), level="high" if is_dm or kind == "mention" else "normal",
        via="connector",
        meta={"channel": channel_id, "ts": ts, "thread_ts": "", "channel_name": "" if is_dm else channel_name},
    )
