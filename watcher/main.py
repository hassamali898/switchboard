"""The watcher: runs the adapters, applies alert levels, stores items, streams NDJSON.

    python -m watcher.main --stream          watch Slack and Gmail
    python -m watcher.main --stream --demo   the design's demo items, no tokens needed

One JSON object per line on stdout:
    {"type": "hello", "mode": "watch" | "tail" | "demo"}
    {"type": "snapshot", "items": [...]}             unread and recent items at start
    {"type": "item", "new": true, "item": {...}}     a new or updated item
    {"type": "source", "source": "slack", "state": "live", "message": "Live"}
    {"type": "ping"}                                  every 30 s

A lock file keeps one watcher across Claude Code windows; a second one tails the
SQLite queue instead and takes over if the first exits.
"""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import sys
import threading
import time
from typing import Any, Optional

from . import demo, paths
from .auth.secrets import redact
from .items import Item
from .queue import Queue
from .rules import Priorities

SNAPSHOT_LIMIT = 100
PING_SECONDS = 30
ARCHIVE_EVERY_SECONDS = 6 * 3600


class Output:
    """Thread-safe NDJSON writer. A closed pipe (the plugin went away) stops the watcher."""

    def __init__(self, stop: threading.Event):
        self.lock = threading.Lock()
        self.stop = stop

    def emit(self, event: dict[str, Any]) -> None:
        line = json.dumps(event, ensure_ascii=False)
        with self.lock:
            try:
                sys.stdout.write(line + "\n")
                sys.stdout.flush()
            except (BrokenPipeError, ValueError):
                self.stop.set()


def try_lock():
    """Returns the open lock file when this process is the one watcher, else None."""
    handle = open(paths.lock_path(), "a+")
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close()
        return None
    handle.seek(0)
    handle.truncate()
    handle.write(str(os.getpid()))
    handle.flush()
    return handle


ADAPTER_RETRY_SECONDS = 60


class Watcher:
    def __init__(self, queue: Queue, out: Output, stop: threading.Event):
        self.queue = queue
        self.out = out
        self.stop = stop
        self.lock = threading.Lock()
        self.config_path = paths.user_config("priorities.yaml")
        self.config_mtime = 0.0
        self.priorities = Priorities()
        self.own_seqs: set[int] = set()
        self.seen: set[str] = set()
        self.reload_priorities()

    def reload_priorities(self) -> None:
        try:
            # Looked up each time: a priorities.yaml you create later replaces the shipped example.
            path = paths.user_config("priorities.yaml")
            if path != self.config_path:
                self.config_path, self.config_mtime = path, 0.0
            mtime = self.config_path.stat().st_mtime
            if mtime != self.config_mtime:
                self.priorities = Priorities.load(self.config_path)
                self.config_mtime = mtime
        except Exception as exc:
            self.status("config", "error", f"priorities.yaml: {exc}")

    def ingest(self, item: Item) -> None:
        with self.lock:
            kept = self.priorities.apply(item)
            if kept is None:
                return
            stored, is_new = self.queue.upsert(kept)
            if not self.queue.last_seq_written:
                return  # unchanged: already shown
            self.own_seqs.add(self.queue.last_seq_written)
            self.seen.add(stored.id)
        self.out.emit({"type": "item", "new": is_new, "item": stored.to_json()})

    def follow_others(self) -> None:
        """Streams what other processes write: connector mail the plugin ingests, read marks."""
        cursor = self.queue.last_seq()
        while not self.stop.wait(1.0):
            with self.lock:
                changes, cursor = self.queue.changes_since(cursor)
                fresh = []
                for item, seq in changes:
                    if seq in self.own_seqs:
                        self.own_seqs.discard(seq)
                        continue
                    fresh.append((item, item.id not in self.seen and not item.read))
                    self.seen.add(item.id)
            for item, is_new in fresh:
                self.out.emit({"type": "item", "new": is_new, "item": item.to_json()})

    def status(self, source: str, state: str, message: str) -> None:
        self.out.emit({"type": "source", "source": source, "state": state, "message": redact(message)})

    def snapshot(self) -> None:
        items = self.queue.list(limit=SNAPSHOT_LIMIT)
        self.seen.update(i.id for i in items)
        self.out.emit({"type": "snapshot", "items": [i.to_json() for i in items]})

    def start_adapter(self, name: str, factory) -> None:
        """Runs a source until the watcher stops. One that can't start or stops (not connected yet, a
        rejected token, paused) is tried again every minute, so Connect and Resume work without a restart."""
        def run() -> None:
            from .auth import google, slack

            last = ("", "")
            while not self.stop.is_set():
                said = None
                try:
                    adapter = factory()
                    adapter.run(self.ingest, self.status, self.stop)
                except (slack.NotConnected, google.NotConnected) as exc:
                    said = ("setup", str(exc))  # the pane shows the Connect steps
                except Exception as exc:
                    paused = type(exc).__name__.endswith("Paused")
                    said = ("paused" if paused else "error", str(exc) if paused else f"{name} stopped: {exc}")
                if said and said != last:  # say each problem once, not every minute
                    self.status(name, *said)
                    last = said
                if self.stop.wait(ADAPTER_RETRY_SECONDS):
                    return

        threading.Thread(target=run, name=f"adapter-{name}", daemon=True).start()

    def housekeeping(self) -> None:
        last_archive = 0.0
        while not self.stop.wait(PING_SECONDS):
            self.out.emit({"type": "ping"})
            self.reload_priorities()
            if time.time() - last_archive > ARCHIVE_EVERY_SECONDS:
                with self.lock:
                    self.queue.archive_old()
                last_archive = time.time()


def slack_factory(queue_path: str, watch: list[str]):
    def build():
        from .adapters.slack import SlackAdapter
        from .auth import slack as slack_auth

        app_token, user_token = slack_auth.tokens()
        return SlackAdapter(Queue(queue_path), watch, app_token, user_token)

    return build


def gmail_factory(queue_path: str):
    def build():
        from .adapters.gmail import GmailAdapter
        from .auth import google
        from .auth.secrets import config_value

        return GmailAdapter(Queue(queue_path), google.credentials(),
                            config_value("GMAIL_PUBSUB_TOPIC"), config_value("GMAIL_PUBSUB_SUBSCRIPTION"))

    return build


def run_demo(watcher: Watcher) -> None:
    for item in demo.backlog():
        watcher.ingest(item)
    watcher.status("slack", "live", "Demo")
    watcher.status("gmail", "live", "Demo")
    for delay, item in demo.live():
        if watcher.stop.wait(delay):
            return
        item.received_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        watcher.ingest(item)


def tail(queue: Queue, out: Output, stop: threading.Event, seen: set[str]) -> bool:
    """Follows the queue another watcher writes. True when that watcher went away.

    `seen`: ids this window already has, so a re-ingested item never alerts twice."""
    seq = queue.last_seq()
    last_ping = time.time()
    while not stop.wait(1.0):
        changes, seq = queue.changes_since(seq)
        for item, _ in changes:
            out.emit({"type": "item", "new": item.id not in seen and not item.read, "item": item.to_json()})
            seen.add(item.id)
        if time.time() - last_ping > PING_SECONDS:
            out.emit({"type": "ping"})
            last_ping = time.time()
        handle = try_lock()
        if handle is not None:
            handle.close()  # released; the caller re-acquires as the watcher
            return True
    return False


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m watcher.main")
    parser.add_argument("--stream", action="store_true", help="write NDJSON events to stdout")
    parser.add_argument("--demo", action="store_true", help="emit the design's demo items (no tokens)")
    parser.add_argument("--sources", default="slack,gmail", help="comma-separated sources to watch")
    args = parser.parse_args(argv)
    if args.demo:
        os.environ["SWITCHBOARD_DEMO"] = "1"

    stop = threading.Event()
    out = Output(stop)
    queue = Queue()

    handle = try_lock()
    if handle is None:
        out.emit({"type": "hello", "mode": "tail"})
        follower = Watcher(queue, out, stop)
        follower.snapshot()
        # When the watching window goes, one follower takes over; the others keep following it.
        while handle is None:
            if not tail(queue, out, stop, follower.seen):
                return 0
            handle = try_lock()

    watcher = Watcher(queue, out, stop)
    out.emit({"type": "hello", "mode": "demo" if args.demo else "watch"})
    with watcher.lock:
        queue.archive_old()
    watcher.snapshot()
    threading.Thread(target=watcher.housekeeping, name="housekeeping", daemon=True).start()
    threading.Thread(target=watcher.follow_others, name="follow", daemon=True).start()

    if args.demo:
        threading.Thread(target=run_demo, args=(watcher,), name="demo", daemon=True).start()
    else:
        sources = {s.strip() for s in args.sources.split(",") if s.strip()}
        if "slack" in sources:
            watcher.start_adapter("slack", slack_factory(queue.path, watcher.priorities.slack_watch))
        if "gmail" in sources:
            from . import modes

            gmail_mode = modes.mode("gmail")
            if gmail_mode == "direct":
                watcher.start_adapter("gmail", gmail_factory(queue.path))
            elif not gmail_mode:
                watcher.status("gmail", "setup", "Choose how to connect Gmail in Settings.")
            # connector mode: the plugin checks Gmail through Claude's connector

    try:
        while not stop.wait(1.0):
            pass
    except KeyboardInterrupt:
        stop.set()
    handle.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
