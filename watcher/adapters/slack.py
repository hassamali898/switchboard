"""Slack adapter: Socket Mode for DMs, mentions and your threads (user-token events).

The Slack app subscribes to these events *on behalf of users*:
message.im, message.mpim, message.channels, message.groups.
"""

from __future__ import annotations

import hashlib
import re
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from ..items import Item, Person, Thread, one_line, ts_to_iso
from .base import Emit, Status

SOURCE = "slack"
MY_THREADS_KEY = "slack:my_threads"
CURSOR_KEY = "slack:last_ts"
LIVE_KEY = "slack:last_live"
MAX_TRACKED_THREADS = 500

# Subtypes that are not a person writing to you.
SKIP_SUBTYPES = {
    "bot_message", "channel_join", "channel_leave", "channel_topic", "channel_purpose",
    "channel_name", "channel_archive", "channel_unarchive", "group_join", "group_leave",
    "pinned_item", "unpinned_item", "ekm_access_denied", "reminder_add", "tombstone",
}


@dataclass
class SlackContext:
    me: str
    team: str = ""
    watch: list[str] = field(default_factory=lambda: ["dms", "mentions", "threads"])
    my_threads: set[str] = field(default_factory=set)  # "channel:thread_ts"
    user_name: Callable[[str], tuple[str, str]] = lambda uid: (uid, "")  # -> (name, email)
    channel_name: Callable[[str], str] = lambda cid: cid
    permalink: Callable[[str, str], str] = lambda cid, ts: ""


def clean_text(text: str, ctx: SlackContext) -> str:
    """Slack markup to plain text: <@U1> → @Name, <#C1|dev> → #dev, <url|label> → label."""

    def user(m: re.Match) -> str:
        return "@" + ctx.user_name(m.group(1))[0]

    text = re.sub(r"<@([UW][A-Z0-9_]+)(?:\|[^>]*)?>", user, text)
    text = re.sub(r"<#[CG][A-Z0-9]+\|([^>]*)>", r"#\1", text)
    text = re.sub(r"<!(here|channel|everyone)(?:\|[^>]*)?>", r"@\1", text)
    text = re.sub(r"<(https?://[^|>]+)\|([^>]+)>", r"\2", text)
    text = re.sub(r"<(https?://[^>]+)>", r"\1", text)
    return text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")


def text_hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def classify(event: dict[str, Any], ctx: SlackContext) -> Optional[str]:
    """dm | mention | thread, or None when the message is not for you."""
    channel_type = event.get("channel_type", "")
    channel = event.get("channel", "")
    if channel_type in ("im", "mpim") or channel.startswith("D"):
        return "dm" if "dms" in ctx.watch else None
    text = event.get("text") or ""
    if "mentions" in ctx.watch and f"<@{ctx.me}" in text:
        return "mention"
    thread_ts = event.get("thread_ts")
    if "threads" in ctx.watch and thread_ts and thread_ts != event.get("ts"):
        if event.get("parent_user_id") == ctx.me or f"{channel}:{thread_ts}" in ctx.my_threads:
            return "thread"
    return None


def note_own_message(event: dict[str, Any], ctx: SlackContext) -> Optional[str]:
    """Remembers threads you posted in. Returns the thread key when one was added."""
    if event.get("user") != ctx.me:
        return None
    key = f"{event.get('channel')}:{event.get('thread_ts') or event.get('ts')}"
    if key in ctx.my_threads:
        return None
    ctx.my_threads.add(key)
    return key


def normalize(event: dict[str, Any], ctx: SlackContext) -> Optional[Item]:
    """One Slack `message` event → an Item, or None to skip it silently."""
    subtype = event.get("subtype")
    deleted = False
    if subtype == "message_changed":
        inner = dict(event.get("message") or {})
        inner.setdefault("channel", event.get("channel"))
        inner.setdefault("channel_type", event.get("channel_type"))
        event = inner
        subtype = event.get("subtype")
    elif subtype == "message_deleted":
        prev = dict(event.get("previous_message") or {})
        prev.setdefault("channel", event.get("channel"))
        prev.setdefault("channel_type", event.get("channel_type"))
        event, subtype, deleted = prev, prev.get("subtype"), True

    if subtype in SKIP_SUBTYPES or event.get("bot_id") or event.get("bot_profile"):
        return None
    user = event.get("user")
    if not user or user == ctx.me or user == "USLACKBOT":
        return None
    kind = classify(event, ctx)
    if kind is None:
        return None

    channel = event["channel"]
    ts = event["ts"]
    thread_ts = event.get("thread_ts") or ts
    name, email = ctx.user_name(user)
    text = clean_text(event.get("text") or "", ctx)
    files = [f.get("name") or f.get("title") or "file" for f in event.get("files") or []]
    channel_name = "" if kind == "dm" else ctx.channel_name(channel)

    title = "(message deleted)" if deleted else one_line(text) or ("📎 " + ", ".join(files) if files else "(no text)")

    meta = {
        "channel": channel,
        "channel_name": channel_name,
        "channel_type": event.get("channel_type", ""),
        "ts": ts,
        "thread_ts": event.get("thread_ts") or "",
        "edited": bool(event.get("edited")),
        "text_hash": text_hash(event.get("text") or ""),
        "deleted": deleted,
        "files": files,
        "team": ctx.team,
    }
    return Item(
        id=f"slack:{channel}:{ts}",
        source="slack",
        kind=kind,
        sender=Person(name=name, handle=user, email=email),
        title=title,
        body=text if not deleted else "(message deleted)",
        url=ctx.permalink(channel, ts),
        thread=Thread(id=f"{channel}:{thread_ts}", count=int(event.get("reply_count") or 1)),
        received_at=ts_to_iso(float(ts)),
        meta=meta,
    )


class SlackAdapter:
    """Socket Mode: Slack pushes events, so nothing is polled. Every Web API call (names,
    catch-up after a reconnect) goes through the account-safety guard."""

    source = SOURCE
    BACKFILL_DMS = 20
    BACKFILL_THREADS = 20
    BACKFILL_AFTER_GAP_S = 30

    def __init__(self, queue, watch: list[str], app_token: str, user_token: str):
        from slack_sdk import WebClient

        from ..safety import RateGuard

        self.queue = queue
        self.app_token = app_token
        self.guard = RateGuard(queue, "slack")
        self.connect_guard = RateGuard(queue, "slack-connect")  # apps.connections.open: ~1/min
        self.web = WebClient(token=user_token)
        auth = self.call("auth_test")
        self.ctx = SlackContext(
            me=auth["user_id"],
            team=auth.get("team_id", ""),
            watch=watch,
            my_threads=set(queue.get_kv(MY_THREADS_KEY, [])),
            user_name=self._user_name,
            channel_name=self._channel_name,
            permalink=self._permalink,
        )
        self._users: dict[str, tuple[str, str]] = {}
        self._channels: dict[str, str] = {}
        self._lock = threading.Lock()

    # ---- every Web API call goes through here --------------------------------------

    def call(self, method: str, max_wait: Optional[float] = None, **kwargs: Any) -> Any:
        from slack_sdk.errors import SlackApiError

        from ..safety import classify, retry_after

        if not self.guard.acquire(max_wait=max_wait, stop=getattr(self, "_stop", None)):
            raise SlackPaused(self.guard.status()["reason"] or "Slack is paused for safety.")
        try:
            result = getattr(self.web, method)(**kwargs)
        except SlackApiError as exc:
            error = str(exc.response.get("error", "")) if exc.response is not None else str(exc)
            status_code = getattr(exc.response, "status_code", 0)
            kind = "rate" if status_code == 429 or error == "ratelimited" else classify(error)
            if kind == "rate":
                self.guard.limited(retry_after(exc))
            elif kind == "auth":
                self.guard.auth_failed("Slack rejected the token. Reconnect Slack in Settings.")
            raise
        self.guard.ok()
        return result

    # ---- lookups (cached) --------------------------------------------------

    def _user_name(self, uid: str) -> tuple[str, str]:
        if uid not in self._users:
            try:
                user = self.call("users_info", max_wait=3, user=uid)["user"]
                profile = user.get("profile") or {}
                name = profile.get("real_name") or profile.get("display_name") or user.get("name") or uid
                self._users[uid] = (name, profile.get("email", ""))
            except Exception:
                return (uid, "")  # not cached: try again on the next message
        return self._users[uid]

    def _channel_name(self, cid: str) -> str:
        if cid not in self._channels:
            try:
                self._channels[cid] = self.call("conversations_info", max_wait=3, channel=cid)["channel"].get("name", cid)
            except Exception:
                return cid
        return self._channels[cid]

    def _permalink(self, cid: str, ts: str) -> str:
        # Built locally: no API call per message.
        return f"https://app.slack.com/client/{self.ctx.team}/{cid}" if self.ctx.team else ""

    # ---- events --------------------------------------------------------------

    def handle_event(self, event: dict[str, Any], emit: Emit) -> None:
        if event.get("type") != "message":
            return
        with self._lock:
            added = note_own_message(event, self.ctx)
            if added:
                self.queue.set_kv(MY_THREADS_KEY, sorted(self.ctx.my_threads)[-MAX_TRACKED_THREADS:])
            item = normalize(event, self.ctx)
            if item and item.meta["deleted"] and self.queue.get(item.id) is None:
                item = None  # a deletion only updates a message already shown; it never becomes an alert
                emit(item)
                last = float(self.queue.get_kv(CURSOR_KEY, 0) or 0)
                if float(item.meta["ts"]) > last:
                    self.queue.set_kv(CURSOR_KEY, item.meta["ts"])

    def backfill(self, emit: Emit) -> None:
        """Catch up after a gap: recent DMs and threads only, each call paced by the guard.

        Capped on purpose (20 DMs, 20 threads): checking every conversation after each
        reconnect is how integrations get rate-limited.
        """
        oldest = self.queue.get_kv(CURSOR_KEY)
        last_live = float(self.queue.get_kv(LIVE_KEY, 0) or 0)
        if not oldest:
            self.queue.set_kv(CURSOR_KEY, f"{time.time():.6f}")
            return
        if time.time() - last_live < self.BACKFILL_AFTER_GAP_S:
            return
        if "dms" in self.ctx.watch:
            for channel in self.queue.recent_slack_channels("dm", self.BACKFILL_DMS):
                try:
                    history = self.call("conversations_history", channel=channel, oldest=oldest, limit=50)
                except SlackPaused:
                    raise
                except Exception:  # a DM you can't read any more (left, archived) never blocks the rest
                    continue
                for msg in reversed(history.get("messages", [])):
                    msg.setdefault("channel", channel)
                    msg.setdefault("channel_type", "im" if channel.startswith("D") else "mpim")
                    self.handle_event({"type": "message", **msg}, emit)
        if "threads" in self.ctx.watch:
            for key in sorted(self.ctx.my_threads)[-self.BACKFILL_THREADS:]:
                channel, thread_ts = key.split(":", 1)
                try:
                    replies = self.call("conversations_replies", channel=channel, ts=thread_ts, oldest=oldest, limit=50)
                except SlackPaused:
                    raise
                except Exception:
                    continue
                for msg in replies.get("messages", []):
                    if msg.get("ts") == thread_ts:
                        continue
                    msg.setdefault("channel", channel)
                    self.handle_event({"type": "message", **msg}, emit)

    def run(self, emit: Emit, status: Status, stop: threading.Event) -> None:
        from slack_sdk.socket_mode import SocketModeClient
        from slack_sdk.socket_mode.request import SocketModeRequest
        from slack_sdk.socket_mode.response import SocketModeResponse

        from ..auth.secrets import redact
        from ..safety import classify

        self._stop = stop

        def on_request(client: SocketModeClient, req: SocketModeRequest) -> None:
            client.send_socket_mode_response(SocketModeResponse(envelope_id=req.envelope_id))
            if req.type == "events_api":
                self.handle_event((req.payload or {}).get("event") or {}, emit)

        while not stop.is_set():
            # New connections are rate-limited by Slack (~1 a minute): the connect guard spaces them.
            if not self.connect_guard.acquire(stop=stop):
                break
            client = SocketModeClient(app_token=self.app_token, web_client=self.web,
                                      auto_reconnect_enabled=False)
            client.socket_mode_request_listeners.append(on_request)
            try:
                status(SOURCE, "reconnecting", "Connecting to Slack…")
                client.connect()
                self.connect_guard.ok()
                self.backfill(emit)
                status(SOURCE, "live", "Live")
                while not stop.is_set():
                    self.queue.set_kv(LIVE_KEY, time.time())
                    stop.wait(5)
                    if not client.is_connected():
                        raise ConnectionError("Slack connection dropped")
            except SlackPaused as exc:
                status(SOURCE, "paused", str(exc))
                stop.wait(60)
            except Exception as exc:  # network loss, sleep/wake, revoked token
                message = redact(str(exc))
                if classify(message) == "auth":
                    self.guard.auth_failed("Slack rejected the token. Reconnect Slack in Settings.")
                    status(SOURCE, "auth", "Slack rejected the token. Reconnect Slack in Settings.")
                    return  # never retry rejected credentials
                if classify(message) == "rate":
                    wait = self.connect_guard.limited()
                else:
                    wait = self.connect_guard.failed()
                status(SOURCE, "reconnecting", f"Slack offline, retrying in {int(wait)} s")
                stop.wait(wait)
            finally:
                try:
                    client.close()
                except Exception:
                    pass


class SlackPaused(RuntimeError):
    """The safety guard is holding Slack calls (paused, backing off, or a cap reached)."""
