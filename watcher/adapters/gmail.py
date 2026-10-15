"""Gmail adapter: users.watch → Pub/Sub pull subscription → history.list.

The watch is renewed daily (Gmail stops pushing after 7 days). Every 60 s the
adapter also checks history on its own, so mail still arrives when push is
silent or not configured.
"""

from __future__ import annotations

import base64
import email.utils
import threading
import time
from typing import Any, Optional

from ..items import Item, Person, Thread, one_line, ts_to_iso
from .base import Emit, Status

SOURCE = "gmail"
HISTORY_KEY = "gmail:history_id"
WATCH_KEY = "gmail:watch_renewed_at"
POLL_SECONDS = 60
WATCH_RENEW_SECONDS = 24 * 3600
BODY_LIMIT = 8000

SKIP_LABELS = {"SENT", "DRAFT", "SPAM", "TRASH", "CHAT"}


def header_map(payload: dict[str, Any]) -> dict[str, str]:
    return {h["name"].lower(): h["value"] for h in payload.get("headers", [])}


def _decode(data: str) -> str:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode("utf-8", "replace")


def plain_body(payload: dict[str, Any]) -> str:
    """The text/plain part, else a tag-stripped text/html part, else ''."""
    def walk(part: dict[str, Any], mime: str) -> Optional[str]:
        if part.get("mimeType") == mime and (part.get("body") or {}).get("data"):
            return _decode(part["body"]["data"])
        for child in part.get("parts") or []:
            found = walk(child, mime)
            if found:
                return found
        return None

    text = walk(payload, "text/plain")
    if text is None:
        # HTML-only mail becomes a Markdown preview; remote images are dropped (watcher/markdown.py).
        from ..markdown import html_to_markdown

        text = html_to_markdown(walk(payload, "text/html") or "")
    return strip_quoted(text).strip()[:BODY_LIMIT]


def strip_quoted(text: str) -> str:
    """Drops the quoted reply chain ("On … wrote:" and '>' lines)."""
    out = []
    for line in text.splitlines():
        if line.startswith(">"):
            continue
        if line.strip().startswith("On ") and line.strip().endswith("wrote:"):
            break
        out.append(line)
    return "\n".join(out)


def attachments(payload: dict[str, Any]) -> list[str]:
    names = []

    def walk(part: dict[str, Any]) -> None:
        if part.get("filename"):
            names.append(part["filename"])
        for child in part.get("parts") or []:
            walk(child)

    walk(payload)
    return names


def normalize(msg: dict[str, Any], me: str) -> Optional[Item]:
    """One users.messages.get (format=full) response → an Item, or None to skip."""
    labels = set(msg.get("labelIds") or [])
    if labels & SKIP_LABELS or "INBOX" not in labels:
        return None
    payload = msg.get("payload") or {}
    headers = header_map(payload)
    name, address = email.utils.parseaddr(headers.get("from", ""))
    if address.lower() == me.lower():
        return None
    subject = headers.get("subject", "").strip() or "(no subject)"
    body = plain_body(payload)
    files = attachments(payload)
    preview = one_line(body or msg.get("snippet", ""), 120)
    received = int(msg.get("internalDate", "0")) / 1000 or time.time()
    return Item(
        id=f"gmail:{msg['id']}",
        source="gmail",
        kind="mail",
        sender=Person(name=name or address, handle=address, email=address),
        title=subject,
        body=body or msg.get("snippet", ""),
        url=f"https://mail.google.com/mail/u/0/#inbox/{msg.get('threadId', msg['id'])}",
        thread=Thread(id=msg.get("threadId", msg["id"])),
        received_at=ts_to_iso(received),
        meta={
            "gmail_id": msg["id"],
            "thread_id": msg.get("threadId", msg["id"]),
            "message_id": headers.get("message-id", ""),
            "references": headers.get("references", ""),
            "reply_to": headers.get("reply-to", ""),
            "to": headers.get("to", ""),
            "cc": headers.get("cc", ""),
            "subject": subject,
            "labels": sorted(labels),
            "files": files,
            "preview": preview,
            "unread": "UNREAD" in labels,
        },
    )


class GmailAdapter:
    source = SOURCE

    def __init__(self, queue, creds, topic: Optional[str], subscription: Optional[str]):
        from googleapiclient.discovery import build

        self.queue = queue
        self.creds = creds
        self.topic = topic
        self.subscription = subscription
        from ..safety import RateGuard

        self.guard = RateGuard(queue, "gmail")
        self.service = build("gmail", "v1", credentials=creds, cache_discovery=False)
        self.me = self.execute(self.service.users().getProfile(userId="me"))["emailAddress"]
        self.wake = threading.Event()

    def execute(self, request):
        """Every Gmail API request goes through the account-safety guard."""
        from googleapiclient.errors import HttpError

        from ..safety import classify

        if not self.guard.acquire(stop=getattr(self, "_stop", None)):
            raise GmailPaused(self.guard.status()["reason"] or "Gmail is paused for safety.")
        try:
            result = request.execute(num_retries=0)
        except HttpError as exc:
            text = f"{exc.resp.status} {exc}"
            kind = "rate" if exc.resp.status == 429 else classify(text)
            if exc.resp.status == 403 and "ratelimit" in text.lower().replace(" ", ""):
                kind = "rate"
            if kind == "rate":
                retry = exc.resp.get("retry-after") if hasattr(exc.resp, "get") else None
                self.guard.limited(float(retry) if retry else None)
            elif kind == "auth" or exc.resp.status == 401:
                self.guard.auth_failed("Google rejected the sign-in. Reconnect Gmail in Settings.")
            raise
        self.guard.ok()
        return result

    # ---- push ------------------------------------------------------------------

    def renew_watch(self, force: bool = False) -> None:
        if not self.topic:
            return
        last = float(self.queue.get_kv(WATCH_KEY, 0) or 0)
        if not force and time.time() - last < WATCH_RENEW_SECONDS:
            return
        self.execute(self.service.users().watch(userId="me", body={
            "topicName": self.topic, "labelIds": ["INBOX"], "labelFilterBehavior": "INCLUDE",
        }))
        self.queue.set_kv(WATCH_KEY, time.time())

    def start_pull(self, status: Status):
        """Streaming pull on the subscription; each notification wakes a history sync."""
        if not self.subscription:
            return None
        from google.cloud import pubsub_v1

        subscriber = pubsub_v1.SubscriberClient(credentials=self.creds)

        def on_message(message) -> None:
            message.ack()
            self.wake.set()

        future = subscriber.subscribe(self.subscription, callback=on_message)
        status(SOURCE, "live", "Live")
        return future

    # ---- sync ------------------------------------------------------------------

    def fetch(self, gmail_id: str) -> Optional[dict[str, Any]]:
        from googleapiclient.errors import HttpError

        try:
            return self.execute(self.service.users().messages().get(userId="me", id=gmail_id, format="full"))
        except HttpError as exc:
            if exc.resp.status == 404:  # deleted before we read it
                return None
            raise

    def initial(self, emit: Emit) -> None:
        """First run: start from now, plus unread inbox mail from the last day."""
        profile = self.execute(self.service.users().getProfile(userId="me"))
        resp = self.execute(self.service.users().messages().list(
            userId="me", q="in:inbox is:unread newer_than:1d", maxResults=20))
        for ref in reversed(resp.get("messages", [])):
            msg = self.fetch(ref["id"])
            item = normalize(msg, self.me) if msg else None
            if item:
                emit(item)
        self.queue.set_kv(HISTORY_KEY, profile["historyId"])

    def sync(self, emit: Emit) -> None:
        from googleapiclient.errors import HttpError

        start = self.queue.get_kv(HISTORY_KEY)
        if not start:
            self.initial(emit)
            return
        page = None
        latest = start
        seen: set[str] = set()
        try:
            while True:
                resp = self.execute(self.service.users().history().list(
                    userId="me", startHistoryId=start, historyTypes=["messageAdded"],
                    labelId="INBOX", pageToken=page))
                latest = resp.get("historyId", latest)
                for record in resp.get("history", []):
                    for added in record.get("messagesAdded", []):
                        gid = added["message"]["id"]
                        if gid in seen:
                            continue
                        seen.add(gid)
                        msg = self.fetch(gid)
                        item = normalize(msg, self.me) if msg else None
                        if item:
                            emit(item)
                page = resp.get("nextPageToken")
                if not page:
                    break
        except HttpError as exc:
            if exc.resp.status == 404:  # history id too old: start over from now
                self.queue.set_kv(HISTORY_KEY, None)
                self.initial(emit)
                return
            raise
        self.queue.set_kv(HISTORY_KEY, latest)

    def run(self, emit: Emit, status: Status, stop: threading.Event) -> None:
        from ..auth.secrets import redact
        from ..safety import classify

        self._stop = stop
        pull = None
        while not stop.is_set():
            try:
                self.renew_watch()
                if pull is None:
                    pull = self.start_pull(status)
                    if pull is None:
                        status(SOURCE, "polling", "Every 60 s")
                self.sync(emit)
                # Push wakes us at once; otherwise one cheap history check a minute.
                self.wake.wait(POLL_SECONDS)
                self.wake.clear()
            except GmailPaused as exc:
                status(SOURCE, "paused", str(exc))
                stop.wait(60)
            except Exception as exc:
                message = redact(str(exc))
                if self.guard.load().state == "auth" or classify(message) == "auth":
                    status(SOURCE, "auth", "Google rejected the sign-in. Reconnect Gmail in Settings.")
                    break  # never retry rejected credentials
                if pull is not None:
                    pull.cancel()
                    pull = None
                wait = self.guard.failed() if classify(message) != "rate" else 60
                status(SOURCE, "reconnecting", f"Gmail offline, retrying in {int(wait)} s")
                stop.wait(wait)
        if pull is not None:
            pull.cancel()


class GmailPaused(RuntimeError):
    """The safety guard is holding Gmail requests (paused, backing off, or a cap reached)."""
