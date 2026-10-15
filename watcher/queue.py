"""Local SQLite queue: de-dup by item id, short numbers, cursors, drafts and the action log.

One database file shared by the watcher and the CLI the plugin calls (every window).
WAL mode lets them read and write side by side.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Optional

from . import paths
from .items import Item

ARCHIVE_AFTER_DAYS = 14

SCHEMA = """
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  num INTEGER UNIQUE NOT NULL,
  seq INTEGER NOT NULL,
  source TEXT NOT NULL,
  level TEXT NOT NULL,
  received_at TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS items_seq ON items(seq);
CREATE INDEX IF NOT EXISTS items_received ON items(received_at);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sends (
  idempotency_key TEXT PRIMARY KEY,
  item_id TEXT,
  created_at REAL NOT NULL,
  status TEXT NOT NULL,
  result TEXT,
  rule TEXT
);
CREATE TABLE IF NOT EXISTS drafts (
  item_id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS action_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  action TEXT NOT NULL,
  source TEXT,
  target TEXT,
  item_id TEXT,
  rule TEXT,
  detail TEXT,
  undo TEXT
);
"""


class Queue:
    def __init__(self, path: Optional[Path | str] = None):
        self.path = str(path or paths.db_path())
        fresh = self.path != ":memory:" and not os.path.exists(self.path)
        # Adapter threads share a connection; transactions take self._tx.
        self.db = sqlite3.connect(self.path, timeout=10, isolation_level=None, check_same_thread=False)
        self._tx = threading.RLock()
        self.last_seq_written = 0  # the seq of this connection's latest upsert
        self.db.row_factory = sqlite3.Row
        if self.path != ":memory:":
            self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript(SCHEMA)
        columns = {row["name"] for row in self.db.execute("PRAGMA table_info(sends)")}
        if "rule" not in columns:  # queues made before rule caps counted sends in flight
            self.db.execute("ALTER TABLE sends ADD COLUMN rule TEXT")
        if fresh:
            try:
                os.chmod(self.path, 0o600)
            except OSError:
                pass

    def close(self) -> None:
        self.db.close()

    # ---- counters and cursors -------------------------------------------

    def get_kv(self, key: str, default: Any = None) -> Any:
        row = self.db.execute("SELECT value FROM kv WHERE key = ?", (key,)).fetchone()
        return json.loads(row["value"]) if row else default

    def set_kv(self, key: str, value: Any) -> None:
        self.db.execute(
            "INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, json.dumps(value)),
        )

    # ---- the Inbox session as orchestrator: drafts it prepared, and work other windows ask of it ----

    def put_drafts(self, item_id: str, drafts: dict[str, Any]) -> None:
        """The three replies the Inbox session drafted for an item, for any window's pane."""
        self.set_kv(f"drafts3:{item_id}", {**drafts, "at": time.time()})

    def get_drafts(self, item_id: str) -> Optional[dict[str, Any]]:
        return self.get_kv(f"drafts3:{item_id}")

    def add_request(self, item_id: str, kind: str, text: str, instruction: str, owner: str) -> str:
        """A window asks the Inbox session to draft or improve a reply: no model call runs in that window."""
        import uuid

        request_id = uuid.uuid4().hex[:12]
        self.set_kv(f"request:{request_id}", {"id": request_id, "item_id": item_id, "kind": kind, "text": text[:20000],
                                             "instruction": instruction[:300], "from": owner, "status": "waiting",
                                             "result": "", "error": "", "at": time.time()})
        return request_id

    def take_requests(self, limit: int = 5) -> list[dict[str, Any]]:
        """The Inbox session takes waiting requests (oldest first); ones older than 10 minutes are dropped."""
        now = time.time()
        taken: list[dict[str, Any]] = []
        with self._tx:
            self.db.execute("BEGIN IMMEDIATE")
            try:
                rows = self.db.execute("SELECT key, value FROM kv WHERE key LIKE 'request:%'").fetchall()
                for row in sorted(rows, key=lambda r: json.loads(r["value"]).get("at", 0)):
                    request = json.loads(row["value"])
                    if now - float(request.get("at", 0)) > 600:
                        self.db.execute("DELETE FROM kv WHERE key = ?", (row["key"],))
                        continue
                    stale = request.get("status") == "working" and now - float(request.get("taken_at", 0)) > 120
                    if (request.get("status") != "waiting" and not stale) or len(taken) >= limit:
                        continue
                    request["status"], request["taken_at"] = "working", now
                    self.set_kv(row["key"], request)
                    taken.append(request)
                self.db.execute("COMMIT")
            except Exception:
                self.db.execute("ROLLBACK")
                raise
        return taken

    def finish_request(self, request_id: str, result: str = "", error: str = "") -> None:
        request = self.get_kv(f"request:{request_id}")
        if request:
            self.set_kv(f"request:{request_id}", {**request, "status": "failed" if error else "done",
                                                 "result": result[:20000], "error": error[:300]})

    def get_request(self, request_id: str) -> Optional[dict[str, Any]]:
        return self.get_kv(f"request:{request_id}")

    def _next(self, counter: str) -> int:  # call inside a transaction
        value = int(self.get_kv(counter, 0)) + 1
        self.set_kv(counter, value)
        return value

    # ---- items ------------------------------------------------------------

    def upsert(self, item: Item) -> tuple[Item, bool]:
        """Insert a new item or update one in place (edits, thread counts).

        Returns the stored item and whether it is new. A known id keeps its
        number and read state, so a repeated event never makes a second item.
        """
        with self._tx:
            return self._upsert(item)

    def _upsert(self, item: Item) -> tuple[Item, bool]:
        self.db.execute("BEGIN IMMEDIATE")
        try:
            row = self.db.execute("SELECT num, read, level, data FROM items WHERE id = ?", (item.id,)).fetchone()
            is_new = row is None
            if is_new:
                item.num = self._next("counter:num")
            else:
                item.num = row["num"]
                item.read = bool(row["read"])
            data = json.dumps(item.to_row())
            if not is_new and row["level"] == item.level and row["data"] == data:
                self.db.execute("COMMIT")
                self.last_seq_written = 0  # nothing changed: nothing to tell other windows
                return item, False
            seq = self._next("counter:seq")
            self.db.execute(
                """INSERT INTO items(id, num, seq, source, level, received_at, read, data)
                   VALUES(?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET seq = excluded.seq, level = excluded.level,
                     data = excluded.data""",
                (item.id, item.num, seq, item.source, item.level, item.received_at,
                 int(item.read), data),
            )
            self.db.execute("COMMIT")
        except Exception:
            self.db.execute("ROLLBACK")
            raise
        self.last_seq_written = seq
        return item, is_new

    def _from_row(self, row: sqlite3.Row) -> Item:
        item = Item.from_row(json.loads(row["data"]))
        item.num = row["num"]
        item.read = bool(row["read"])
        return item

    def get(self, ref: str | int) -> Optional[Item]:
        """By id (`slack:C1:123.4`), by number (12) or by `#12`."""
        text = str(ref).lstrip("#")
        if text.isdecimal() and text.isascii():
            row = self.db.execute("SELECT * FROM items WHERE num = ?", (int(text),)).fetchone()
        else:
            row = self.db.execute("SELECT * FROM items WHERE id = ?", (text,)).fetchone()
        return self._from_row(row) if row else None

    def list(self, *, unread_only: bool = False, source: Optional[str] = None,
             limit: int = 200) -> list[Item]:
        sql = "SELECT * FROM items WHERE archived = 0"
        args: list[Any] = []
        if unread_only:
            sql += " AND read = 0"
        if source:
            sql += " AND source = ?"
            args.append(source)
        sql += " ORDER BY received_at DESC, num DESC LIMIT ?"
        args.append(limit)
        return [self._from_row(r) for r in self.db.execute(sql, args)]

    def recent_slack_channels(self, kind: str, limit: int) -> list[str]:
        """Channels of the most recent Slack items of `kind`, newest first (for capped catch-up)."""
        rows = self.db.execute(
            "SELECT json_extract(data, '$.meta.channel') AS channel, MAX(received_at) AS latest FROM items "
            "WHERE source = 'slack' AND json_extract(data, '$.kind') = ? "
            "AND json_extract(data, '$.meta.demo') IS NULL "
            "GROUP BY channel ORDER BY latest DESC LIMIT ?", (kind, limit)).fetchall()
        return [r["channel"] for r in rows if r["channel"]]

    def changes_since(self, seq: int) -> tuple[list[tuple[Item, int]], int]:
        """Items written after `seq` with their seq (any process, this one included)."""
        rows = self.db.execute("SELECT * FROM items WHERE seq > ? ORDER BY seq", (seq,)).fetchall()
        last = rows[-1]["seq"] if rows else seq
        return [(self._from_row(r), r["seq"]) for r in rows], last

    def lease(self, name: str, owner: str, ttl: float, now: Optional[float] = None, force: bool = False) -> dict[str, Any]:
        """One holder at a time (e.g. which Claude Code window checks Gmail). Renew before ttl ends.

        `force`: take it over (the Inbox session, which should poll when it is open)."""
        now = now if now is not None else time.time()
        with self._tx:
            self.db.execute("BEGIN IMMEDIATE")
            try:
                held = self.get_kv(f"lease:{name}") or {}
                if force or held.get("owner") in (None, owner) or float(held.get("until", 0)) <= now:
                    held = {"owner": owner, "until": now + ttl}
                    self.set_kv(f"lease:{name}", held)
                self.db.execute("COMMIT")
            except Exception:
                self.db.execute("ROLLBACK")
                raise
        return {"granted": held["owner"] == owner, "owner": held["owner"], "until": held["until"]}

    def last_seq(self) -> int:
        return int(self.get_kv("counter:seq", 0))

    def mark_read(self, refs: Iterable[str | int] | None = None) -> int:
        """Mark items read; no refs marks everything read. Bumps seq so other windows see it."""
        if refs is None:
            ids = [r["id"] for r in self.db.execute("SELECT id FROM items WHERE read = 0")]
        else:
            ids = [item.id for item in (self.get(ref) for ref in refs) if item and not item.read]
        return self._set_read(ids, True)

    def mark_unread(self, refs: Iterable[str | int]) -> int:
        """Puts items back as unread (Undo of an auto rule's archive). Bumps seq so other windows see it."""
        return self._set_read([item.id for item in (self.get(ref) for ref in refs) if item and item.read], False)

    def _set_read(self, ids: list[str], read: bool) -> int:
        if not ids:
            return 0
        with self._tx:
            self.db.execute("BEGIN IMMEDIATE")
            try:
                for item_id in ids:
                    self.db.execute("UPDATE items SET read = ?, seq = ? WHERE id = ?",
                                    (int(read), self._next("counter:seq"), item_id))
                self.db.execute("COMMIT")
            except Exception:
                self.db.execute("ROLLBACK")
                raise
        return len(ids)

    def archive_old(self, days: int = ARCHIVE_AFTER_DAYS, now: Optional[datetime] = None) -> int:
        cutoff = (now or datetime.now(timezone.utc)) - timedelta(days=days)
        stamp = cutoff.strftime("%Y-%m-%dT%H:%M:%SZ")
        cur = self.db.execute(
            "UPDATE items SET archived = 1 WHERE archived = 0 AND received_at < ?", (stamp,))
        return cur.rowcount

    # ---- drafts -----------------------------------------------------------

    def save_draft(self, item_id: str, text: str) -> None:
        self.db.execute(
            "INSERT INTO drafts(item_id, text, updated_at) VALUES(?, ?, ?) "
            "ON CONFLICT(item_id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at",
            (item_id, text, time.time()),
        )

    def get_draft(self, item_id: str) -> Optional[str]:
        row = self.db.execute("SELECT text FROM drafts WHERE item_id = ?", (item_id,)).fetchone()
        return row["text"] if row else None

    def delete_draft(self, item_id: str) -> None:
        self.db.execute("DELETE FROM drafts WHERE item_id = ?", (item_id,))

    # ---- sends (idempotency) and the action log --------------------------

    def claim_send(self, key: str, item_id: Optional[str], window_s: float = 60.0,
                   now: Optional[float] = None, rule: str = "", cap: Optional[int] = None) -> Optional[dict[str, Any]]:
        """Reserve an idempotency key. Returns None when claimed, else the earlier send.

        A key that sent never sends again. One still sending blocks a repeat; after `window_s`
        it comes back as `uncertain` (the attempt never finished, so it may have gone out).
        A failed attempt sent nothing, so it may be retried at once.
        With `rule` and `cap`, the rule's actions today plus its sends in flight must stay under the cap,
        checked in the same transaction, so two tasks at once can't both take the last slot.
        """
        with self._tx:
            return self._claim_send(key, item_id, window_s, now, rule, cap)

    def _claim_send(self, key: str, item_id: Optional[str], window_s: float,
                    now: Optional[float], rule: str = "", cap: Optional[int] = None) -> Optional[dict[str, Any]]:
        now = now if now is not None else time.time()
        self.db.execute("BEGIN IMMEDIATE")
        try:
            row = self.db.execute("SELECT * FROM sends WHERE idempotency_key = ?", (key,)).fetchone()
            if row and row["status"] != "failed":
                self.db.execute("COMMIT")
                status = row["status"]
                if status == "sending" and now - row["created_at"] >= window_s:
                    status = "uncertain"
                return {"status": status, "result": json.loads(row["result"] or "null"),
                        "created_at": row["created_at"]}
            if rule and cap is not None:
                in_flight = self.db.execute(
                    "SELECT COUNT(*) FROM sends WHERE rule = ? AND status = 'sending' AND created_at > ?",
                    (rule, now - 600)).fetchone()[0]
                if self.rule_actions_today(rule) + int(in_flight) >= int(cap):
                    self.db.execute("COMMIT")
                    return {"status": "cap", "result": None, "created_at": now}
            self.db.execute(
                "INSERT INTO sends(idempotency_key, item_id, created_at, status, rule) VALUES(?, ?, ?, 'sending', ?) "
                "ON CONFLICT(idempotency_key) DO UPDATE SET created_at = excluded.created_at, status = 'sending', "
                "rule = excluded.rule",
                (key, item_id, now, rule),
            )
            self.db.execute("COMMIT")
            return None
        except Exception:
            self.db.execute("ROLLBACK")
            raise

    def finish_send(self, key: str, status: str, result: Any = None) -> None:
        self.db.execute(
            "UPDATE sends SET status = ?, result = ? WHERE idempotency_key = ?",
            (status, json.dumps(result), key),
        )

    def log_action(self, action: str, *, source: str = "", target: str = "", item_id: str = "",
                   rule: str = "", detail: Any = None, undo: Any = None) -> int:
        cur = self.db.execute(
            "INSERT INTO action_log(at, action, source, target, item_id, rule, detail, undo) "
            "VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
            (datetime.now(timezone.utc).isoformat(timespec="seconds"), action, source, target,
             item_id, rule, json.dumps(detail), json.dumps(undo)),
        )
        return int(cur.lastrowid)

    def rule_actions_today(self, rule: str, now: Optional[datetime] = None) -> int:
        """What a rule did since local midnight: its daily cap counts these. Undo entries don't count back."""
        local = (now or datetime.now()).astimezone()
        midnight = local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
        row = self.db.execute(
            "SELECT COUNT(*) FROM action_log WHERE rule = ? AND action != 'undo' AND at >= ?",
            (rule, midnight.isoformat(timespec="seconds")),
        ).fetchone()
        return int(row[0])

    def actions(self, limit: int = 50) -> list[dict[str, Any]]:
        rows = self.db.execute("SELECT * FROM action_log ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [_action(r) for r in rows]

    def get_action(self, action_id: int) -> Optional[dict[str, Any]]:
        row = self.db.execute("SELECT * FROM action_log WHERE id = ?", (action_id,)).fetchone()
        return _action(row) if row else None

    def was_undone(self, action_id: int) -> bool:
        row = self.db.execute("SELECT 1 FROM action_log WHERE action = 'undo' AND json_extract(detail, '$.undid') = ?",
                              (action_id,)).fetchone()
        return row is not None


def _action(row: sqlite3.Row) -> dict[str, Any]:
    entry = dict(row)
    entry["detail"] = json.loads(entry["detail"] or "null")
    entry["undo"] = json.loads(entry["undo"] or "null")
    return entry
