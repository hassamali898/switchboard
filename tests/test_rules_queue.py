from datetime import datetime, timedelta, timezone

import pytest

from watcher import paths
from watcher.items import Item, Person
from watcher.rules import Priorities


def make(source="slack", kind="dm", name="Someone", title="hi", body="", **meta):
    return Item(id=f"{source}:{name}:{title}", source=source, kind=kind, sender=Person(name=name, email=meta.pop("email", "")),
                title=title, body=body, received_at="2026-10-03T10:00:00Z", meta=meta)


PRIOS = {
    "default_level": "normal",
    "rules": [
        {"name": "lead", "from": ["Ahmed Raza"], "level": "critical"},
        {"name": "prod", "source": "slack", "channel": "acme-prod", "level": "critical"},
        {"name": "review", "source": "slack", "kind": "dm", "keywords": ["review"], "level": "high"},
        {"name": "promos", "source": "gmail", "label": ["CATEGORY_PROMOTIONS"], "level": "quiet"},
        {"name": "domain", "domain": "acme.com", "level": "high"},
    ],
    "quiet_hours": {"enabled": True, "start": "20:00", "end": "09:00"},
    "excluded": {"keywords": ["password"], "gmail_labels": ["Label_HR"]},
    "muted": {"senders": ["noisy@example.com"], "slack_channels": ["random"]},
}
NOON = datetime(2026, 10, 3, 12, 0)


def test_first_match_wins():
    p = Priorities.from_dict(PRIOS)
    assert p.level_for(make(name="Ahmed Raza", title="can you review?"), NOON) == "critical"
    assert p.level_for(make(title="please review this"), NOON) == "high"
    assert p.level_for(make(kind="mention", channel_name="acme-prod"), NOON) == "critical"
    assert p.level_for(make(source="gmail", kind="mail", labels=["INBOX", "CATEGORY_PROMOTIONS"]), NOON) == "quiet"
    assert p.level_for(make(source="gmail", kind="mail", email="x@acme.com"), NOON) == "high"
    assert p.level_for(make(), NOON) == "normal"


def test_quiet_hours_span_midnight_but_keep_critical():
    p = Priorities.from_dict(PRIOS)
    late = datetime(2026, 10, 3, 23, 30)
    early = datetime(2026, 10, 4, 8, 59)
    assert p.level_for(make(title="review pls"), late) == "quiet"
    assert p.level_for(make(), early) == "quiet"
    assert p.level_for(make(), datetime(2026, 10, 4, 9, 0)) == "normal"
    assert p.level_for(make(name="Ahmed Raza"), late) == "critical"


def test_focus_lowers_all_but_critical():
    p = Priorities.from_dict({**PRIOS, "focus": True, "quiet_hours": {"enabled": False}})
    assert p.level_for(make(title="review"), NOON) == "quiet"
    assert p.level_for(make(name="Ahmed Raza"), NOON) == "critical"


def test_excluded_and_muted():
    p = Priorities.from_dict(PRIOS)
    assert p.apply(make(body="your new password is hunter2"), NOON).excluded is True
    assert p.apply(make(source="gmail", kind="mail", labels=["Label_HR"]), NOON).excluded is True
    assert p.apply(make(), NOON).excluded is False
    assert p.apply(make(source="gmail", kind="mail", email="noisy@example.com"), NOON) is None
    assert p.apply(make(kind="mention", channel_name="random"), NOON) is None


def test_bad_level_rejected():
    with pytest.raises(ValueError):
        Priorities.from_dict({"rules": [{"name": "x", "level": "urgent"}]})


def test_shipped_example_config_loads():
    p = Priorities.load(paths.REPO_ROOT / "config" / "priorities.example.yaml")
    assert p.rules and p.slack_watch == ["dms", "mentions", "threads"]


# ---- queue ------------------------------------------------------------------------


def test_dedup_keeps_number_and_read_state(queue):
    first, is_new = queue.upsert(make(title="hello"))
    assert is_new and first.num == 1
    queue.mark_read([first.num])
    again, is_new = queue.upsert(make(title="hello", body="edited"))
    assert not is_new and again.num == 1 and again.read is True
    assert queue.get("#1").body == "edited"
    second, _ = queue.upsert(make(title="other"))
    assert second.num == 2
    assert len(queue.list()) == 2


def test_mark_read_is_visible_to_tailing_windows(queue):
    item, _ = queue.upsert(make())
    seq = queue.last_seq()
    queue.mark_read([item.id])
    changed, new_seq = queue.changes_since(seq)
    assert [i.id for i, _ in changed] == [item.id] and changed[0][0].read and new_seq > seq


def test_unchanged_upsert_writes_nothing(queue):
    """A connector re-ingesting the same unread item every minute must not look like news to other windows."""
    queue.upsert(make())
    seq = queue.last_seq()
    stored, is_new = queue.upsert(make())
    assert not is_new and queue.last_seq_written == 0 and queue.last_seq() == seq
    queue.upsert(make(body="edited"))
    assert queue.last_seq() > seq


def test_odd_refs_and_rows(queue):
    import json
    assert queue.get("²") is None  # isdigit() says yes, int() says no
    item, _ = queue.upsert(make())
    row = json.loads(queue.db.execute("SELECT data FROM items").fetchone()[0])
    row["from_a_newer_version"] = 1
    row["from"]["extra"] = 2
    queue.db.execute("UPDATE items SET data = ?", (json.dumps(row),))
    assert queue.get(item.id).id == item.id


def test_undo_is_recorded_once(queue):
    from watcher import actions
    item, _ = queue.upsert(make())
    done = actions.archive(queue, item.id, rule="Not important", cap=5)
    actions.undo(queue, done["action_id"], actions.Clients())
    queue.mark_read([item.id])
    with pytest.raises(actions.SendBlocked) as err:
        actions.undo(queue, done["action_id"], actions.Clients())
    assert err.value.code == "already_undone" and queue.get(item.id).read


def test_archive_after_14_days(queue):
    old = make(title="old")
    old.received_at = (datetime.now(timezone.utc) - timedelta(days=15)).strftime("%Y-%m-%dT%H:%M:%SZ")
    queue.upsert(old)
    queue.upsert(make(title="new"))
    assert queue.archive_old() == 1
    assert [i.title for i in queue.list()] == ["new"]


def test_idempotency_claims(queue):
    assert queue.claim_send("k1", "i1", now=1000.0) is None
    assert queue.claim_send("k1", "i1", now=1010.0)["status"] == "sending"
    queue.finish_send("k1", "sent", {"ts": "1"})
    assert queue.claim_send("k1", "i1", now=1030.0)["status"] == "sent"
    assert queue.claim_send("k1", "i1", now=99_999.0)["status"] == "sent"  # a sent reply never goes twice
    queue.finish_send("k1", "failed")
    assert queue.claim_send("k1", "i1", now=1101.0) is None  # a failed attempt can retry
    # An attempt that never finished (killed or timed out mid-send) may have gone out: never retried blind.
    assert queue.claim_send("k1", "i1", now=1120.0)["status"] == "sending"
    assert queue.claim_send("k1", "i1", now=1200.0)["status"] == "uncertain"


def test_db_file_is_private(tmp_path):
    import os
    import stat

    from watcher.queue import Queue

    Queue(tmp_path / "private.db").close()
    assert stat.S_IMODE(os.stat(tmp_path / "private.db").st_mode) == 0o600


def test_rule_cap_counts_sends_in_flight(queue):
    """Two auto tasks at once can't both take a rule's last slot."""
    assert queue.claim_send("a", "i1", now=1000.0, rule="Replies", cap=1) is None
    assert queue.claim_send("b", "i2", now=1001.0, rule="Replies", cap=1)["status"] == "cap"
    queue.finish_send("a", "failed")
    assert queue.claim_send("b", "i2", now=1002.0, rule="Replies", cap=1) is None


def test_stale_requests_are_taken_again(queue, monkeypatch):
    import time as clock
    request_id = queue.add_request("i1", "draft", "", "", "window")
    assert [r["id"] for r in queue.take_requests()] == [request_id]
    assert queue.take_requests() == []  # being worked on
    later = clock.time() + 121
    monkeypatch.setattr(clock, "time", lambda: later)
    assert [r["id"] for r in queue.take_requests()] == [request_id]  # the Inbox session died mid-way
