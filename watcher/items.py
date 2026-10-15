"""The common item shape every adapter produces (see CLAUDE.md)."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field, fields
from datetime import datetime, timezone
from typing import Any, Literal, Optional

Source = Literal["slack", "gmail", "calendar", "github", "jira"]
Level = Literal["critical", "high", "normal", "quiet"]
LEVELS: tuple[Level, ...] = ("critical", "high", "normal", "quiet")


@dataclass
class Person:
    name: str
    handle: str = ""
    email: str = ""


@dataclass
class Thread:
    id: str
    count: int = 1


@dataclass
class Item:
    id: str
    source: Source
    kind: str
    sender: Person
    title: str
    body: str = ""
    url: str = ""
    thread: Optional[Thread] = None
    level: Level = "normal"
    received_at: str = ""
    num: int = 0
    read: bool = False
    # Routing data the send path needs (channel, thread_ts, gmail ids, labels...).
    # Never shown in the UI and never sent to Claude.
    meta: dict[str, Any] = field(default_factory=dict)
    # True when the item matched an excluded label/channel/keyword:
    # it is listed, but never sent to Claude.
    excluded: bool = False
    auto: Optional[dict[str, Any]] = None
    # How the item arrived: direct (our own tokens), connector (Claude's connector) or demo.
    via: str = "direct"

    def to_json(self) -> dict[str, Any]:
        """The public shape for the plugin UI (no routing meta)."""
        data = asdict(self)
        data["from"] = data.pop("sender")
        meta = data.pop("meta")
        data["files"] = list(meta.get("files") or [])
        # What the pane may show about where it came from; routing ids and tokens never leave.
        data["details"] = {key: meta[key] for key in PUBLIC_META if meta.get(key) not in (None, "", [])}
        return data

    def to_row(self) -> dict[str, Any]:
        data = asdict(self)
        data["from"] = data.pop("sender")
        return data

    @classmethod
    def from_row(cls, data: dict[str, Any]) -> "Item":
        data = dict(data)
        sender = Person(**_known(Person, data.pop("from") or {}))
        thread = data.pop("thread", None)
        # A row from an older or newer version: fields this one doesn't know are dropped, never a crash.
        return cls(sender=sender, thread=Thread(**_known(Thread, thread)) if thread else None, **_known(cls, data))


# A note you send yourself with this word in it shows in the Inbox, so the plugin can be tried live
# without messaging anyone else. Everything else you sent stays out.
SELF_TEST_TAG = "sbtest"


def is_self_test(text: str) -> bool:
    return SELF_TEST_TAG in (text or "").lower()


PUBLIC_META = ("starts_at", "ends_at", "join_url", "attendees", "status", "priority", "assignee", "repo", "reason",
               "channel_name", "subject", "demo")


def ts_to_iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def one_line(text: str, limit: int = 140) -> str:
    flat = " ".join(text.split())
    return flat if len(flat) <= limit else flat[: limit - 1].rstrip() + "…"


def _known(kind: type, data: dict[str, Any]) -> dict[str, Any]:
    names = {f.name for f in fields(kind)}
    return {key: value for key, value in data.items() if key in names}
