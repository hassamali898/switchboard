"""Gmail through Claude's connector: normalizes the connector's search results into Items.

The plugin (hooks module) makes the connector calls, since only Claude holds that
sign-in, and hands the raw threads to `watcher.cli ingest`. Field names are read
in both spellings (`label_ids` / `labelIds`), since the connector's docs use both.
"""

from __future__ import annotations

import html

import email.utils
from datetime import datetime, timezone
from typing import Any, Optional

from ..items import Item, Person, Thread, is_self_test, one_line, ts_to_iso

SKIP_LABELS = {"SENT", "DRAFT", "SPAM", "TRASH", "CHAT"}


def field(obj: Any, *names: str, default: Any = None) -> Any:
    """The first present field among `names`, trying snake_case and camelCase of each."""
    if not isinstance(obj, dict):
        return default
    for name in names:
        for key in (name, _camel(name)):
            if key in obj and obj[key] not in (None, ""):
                return obj[key]
    return default


def _camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(part[:1].upper() + part[1:] for part in rest)


def person(value: Any) -> Person:
    """'Name <a@b.c>', 'a@b.c', or {name/displayName, email/emailAddress}."""
    if isinstance(value, dict):
        address = str(field(value, "email", "email_address", "address", default=""))
        name = str(field(value, "name", "display_name", default="")) or address
        return Person(name=name, handle=address, email=address)
    name, address = email.utils.parseaddr(str(value or ""))
    return Person(name=name or address, handle=address, email=address)


def addresses(value: Any) -> str:
    """A header-style list ('a@x, B <b@y>') from a string or a list of strings/objects."""
    if not value:
        return ""
    if isinstance(value, str):
        return value
    out = []
    for entry in value if isinstance(value, list) else [value]:
        p = person(entry)
        out.append(f"{p.name} <{p.email}>" if p.name and p.name != p.email else p.email)
    return ", ".join(x for x in out if x)


def timestamp(value: Any) -> float:
    """ISO 8601, RFC 2822, or epoch seconds/milliseconds → epoch seconds (0 if unknown)."""
    if value in (None, ""):
        return 0.0
    if isinstance(value, (int, float)) or (isinstance(value, str) and value.isdigit()):
        number = float(value)
        return number / 1000 if number > 1e12 else number
    text = str(value)
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()
    except ValueError:
        pass
    try:
        return email.utils.parsedate_to_datetime(text).timestamp()
    except (TypeError, ValueError):
        return 0.0


def messages_of(thread: dict[str, Any]) -> list[dict[str, Any]]:
    found = field(thread, "messages", "related_messages", default=[])
    return [m for m in found if isinstance(m, dict)] if isinstance(found, list) else []


def threads_of(result: Any) -> list[dict[str, Any]]:
    """The thread list from a search_threads result (an empty `{}` means none)."""
    if isinstance(result, list):
        return [t for t in result if isinstance(t, dict)]
    found = field(result, "threads", default=[])
    return [t for t in found if isinstance(t, dict)] if isinstance(found, list) else []


def find_me(threads: list[dict[str, Any]]) -> Optional[str]:
    """Your address: the sender of any message labelled SENT."""
    for thread in threads:
        for message in messages_of(thread):
            if "SENT" in set(field(message, "label_ids", default=[]) or []):
                address = person(field(message, "sender", "from")).email
                if address:
                    return address
    return None


def normalize_thread(thread: dict[str, Any], me: Optional[str]) -> Optional[Item]:
    """The newest message in an inbox thread, unless you sent it (then nothing is waiting)."""
    messages = messages_of(thread)
    if not messages:
        return None
    latest = max(messages, key=lambda m: timestamp(field(m, "date", "internal_date")))
    labels = set(field(latest, "label_ids", default=[]) or [])
    sender = person(field(latest, "sender", "from"))
    is_test = is_self_test(str(field(latest, "subject", default="")))
    if labels & (SKIP_LABELS - {"SENT"} if is_test else SKIP_LABELS) or "INBOX" not in labels:
        return None
    if me and sender.email.lower() == me.lower() and not is_test:
        return None
    message_id = str(field(latest, "id", "message_id", default=""))
    thread_id = str(field(thread, "id", "thread_id", default="")) or str(field(latest, "thread_id", default=""))
    if not message_id:
        return None
    subject = str(field(latest, "subject", default="")).strip() or str(field(thread, "subject", default="")).strip() \
        or "(no subject)"
    body = html.unescape(str(field(latest, "plaintext_body", "snippet", default="")))
    attachments = field(latest, "attachments", default=[]) or []
    files = [str(field(a, "filename", "name", default="file")) for a in attachments if isinstance(a, dict)]
    when = timestamp(field(latest, "date", "internal_date")) or datetime.now(timezone.utc).timestamp()
    return Item(
        id=f"gmail:{message_id}",
        source="gmail",
        kind="mail",
        sender=sender,
        title=subject,
        body=body,
        url=str(field(latest, "view_url", default="") or field(thread, "view_url", default="")),
        thread=Thread(id=thread_id, count=len(messages)),
        received_at=ts_to_iso(when),
        via="connector",
        meta={
            "gmail_id": message_id,
            "thread_id": thread_id,
            "message_id": "",
            "references": "",
            "reply_to": "",
            "to": addresses(field(latest, "to_recipients", "to")),
            "cc": addresses(field(latest, "cc_recipients", "cc")),
            "subject": subject,
            "labels": sorted(labels),
            "files": files,
            "preview": one_line(body, 120),
            "unread": "UNREAD" in labels,
        },
    )
