"""Account safety and Gmail-through-Claude's-connector: the guards that keep accounts safe."""

import json
import threading

import pytest

from watcher import actions, cli, safety
from watcher.adapters import gmail_connector
from watcher.queue import Queue


class Clock:
    def __init__(self, t=1_800_000_000.0):
        self.t = t

    def __call__(self):
        return self.t


# ---- the rate guard ---------------------------------------------------------------------


def test_floor_between_calls(queue):
    clock = Clock()
    guard = safety.RateGuard(queue, "gmail", clock)
    assert guard.wait_needed() == (0.0, "")
    guard.record_call()
    wait, _ = guard.wait_needed()
    assert 0 < wait <= safety.LIMITS["gmail"]["floor"]
    clock.t += 5
    assert guard.wait_needed()[0] == 0


def test_hourly_cap_holds_calls(queue):
    clock = Clock()
    guard = safety.RateGuard(queue, "slack", clock)
    for _ in range(int(safety.LIMITS["slack"]["hour"])):
        guard.record_call()
        clock.t += 2
    wait, reason = guard.wait_needed()
    assert wait > 0 and "hourly" in reason
    clock.t += 3600
    assert guard.wait_needed()[0] == 0


def test_slow_downs_back_off_then_pause(queue):
    clock = Clock()
    guard = safety.RateGuard(queue, "gmail", clock)
    first = guard.limited()
    assert 60 <= first <= 72 and guard.status()["state"] == "backoff"
    second = guard.limited(retry_after=500)
    assert second >= 500
    guard.limited()
    status = guard.status()
    assert status["state"] == "paused" and status["until"] - clock.t >= safety.PAUSE_SECONDS
    assert "protect your account" in status["reason"]
    assert guard.wait_needed()[0] > 0


def test_success_resets_strikes(queue):
    guard = safety.RateGuard(queue, "gmail", Clock())
    guard.limited()
    guard.ok()
    guard.limited()
    guard.limited()
    assert guard.status()["state"] == "backoff"  # strikes count only in a row


def test_rejected_sign_in_stops_until_resumed(queue):
    guard = safety.RateGuard(queue, "slack", Clock())
    guard.auth_failed("Slack rejected the token.")
    assert guard.wait_needed()[0] == float("inf")
    assert guard.acquire(sleep=lambda s: None) is False
    guard.ok()  # a later success elsewhere never clears a sign-in stop
    assert guard.status()["state"] == "auth"
    guard.resume()
    assert guard.acquire(sleep=lambda s: None) is True


def test_pause_survives_restart(tmp_path):
    clock = Clock()
    first = Queue(tmp_path / "q.db")
    for _ in range(3):
        safety.RateGuard(first, "gmail", clock).limited()
    first.close()
    again = safety.RateGuard(Queue(tmp_path / "q.db"), "gmail", clock)
    assert again.status()["state"] == "paused"


def test_acquire_gives_up_past_max_wait(queue):
    guard = safety.RateGuard(queue, "slack", Clock())
    guard.limited()
    assert guard.acquire(sleep=lambda s: None, max_wait=3) is False


@pytest.mark.parametrize("text,kind", [
    ("HTTP 429 Too Many Requests", "rate"), ("ratelimited", "rate"), ("Quota exceeded", "rate"),
    ("invalid_auth", "auth"), ("invalid_grant: Token has been expired", "auth"), ("timeout", "other"),
])
def test_classify(text, kind):
    assert safety.classify(text) == kind


# ---- Slack catch-up is capped and paced ----------------------------------------------------


def test_slack_backfill_is_capped(queue, monkeypatch):
    import time as real_time

    from watcher.adapters import slack
    from watcher.items import Item, Person

    for n in range(40):
        queue.upsert(Item(id=f"slack:D{n}:1.{n}", source="slack", kind="dm", sender=Person(name="x"),
                          title="hi", received_at=f"2026-10-03T10:{n:02d}:00Z", meta={"channel": f"D{n:03d}"}))
    calls = []

    class Web:
        def conversations_history(self, **kw):
            calls.append(kw["channel"])
            return {"messages": []}

    adapter = slack.SlackAdapter.__new__(slack.SlackAdapter)
    adapter.queue, adapter.web = queue, Web()
    adapter.guard = safety.RateGuard(queue, "slack")
    monkeypatch.setattr(adapter.guard, "acquire", lambda **kw: True)
    adapter.ctx = slack.SlackContext(me="U_ME", watch=["dms"])
    adapter._lock = threading.Lock()
    queue.set_kv(slack.CURSOR_KEY, "1.0")
    queue.set_kv(slack.LIVE_KEY, real_time.time() - 3600)
    adapter.backfill(lambda item: None)
    assert len(calls) == slack.SlackAdapter.BACKFILL_DMS == 20
    assert calls[0] == "D039"  # most recent conversations first


def test_slack_short_blip_skips_catch_up(queue, monkeypatch):
    import time as real_time

    from watcher.adapters import slack

    adapter = slack.SlackAdapter.__new__(slack.SlackAdapter)
    adapter.queue = queue
    adapter.ctx = slack.SlackContext(me="U_ME", watch=["dms"])
    monkeypatch.setattr(adapter, "call", lambda *a, **k: pytest.fail("no catch-up after a short blip"))
    queue.set_kv(slack.CURSOR_KEY, "1.0")
    queue.set_kv(slack.LIVE_KEY, real_time.time() - 5)
    adapter.backfill(lambda item: None)


# ---- Gmail through Claude's connector ---------------------------------------------------------


def thread(message_id="m1", sender="Sara Khan <sara@example.com>", labels=("INBOX", "UNREAD"), camel=False, **extra):
    message = {"id": message_id, "subject": "Q4 roadmap", "snippet": "Attached are the slides",
               "sender": sender, "to_recipients": ["me@example.com"], "date": "2026-10-03T10:00:00Z",
               "label_ids": list(labels), "view_url": "https://mail.google.com/x", **extra}
    if camel:
        message = {"id": message_id, "subject": "Q4 roadmap", "snippet": "Attached", "sender": sender,
                   "toRecipients": ["me@example.com"], "date": "2026-10-03T10:00:00Z", "labelIds": list(labels)}
    return {"id": "t1", "messages": [message]}


@pytest.mark.parametrize("camel", [False, True])
def test_connector_thread_normalizes_in_either_spelling(camel):
    item = gmail_connector.normalize_thread(thread(camel=camel), "me@example.com")
    assert item.id == "gmail:m1" and item.via == "connector"
    assert item.sender.email == "sara@example.com" and item.title == "Q4 roadmap"
    assert item.thread.id == "t1" and "INBOX" in item.meta["labels"]


def test_connector_skips_your_own_and_non_inbox():
    assert gmail_connector.normalize_thread(thread(sender="Me <me@example.com>"), "me@example.com") is None
    assert gmail_connector.normalize_thread(thread(labels=("SENT",)), None) is None
    assert gmail_connector.normalize_thread(thread(labels=("CATEGORY_UPDATES",)), None) is None


def test_connector_finds_your_address():
    sent = thread(message_id="m2", sender="Alex <me@example.com>", labels=("SENT",))
    assert gmail_connector.find_me([sent]) == "me@example.com"


def test_connector_sender_as_object():
    item = gmail_connector.normalize_thread(
        thread(sender={"displayName": "Sara Khan", "emailAddress": "sara@example.com"}), None)
    assert item.sender.name == "Sara Khan" and item.sender.email == "sara@example.com"


def test_ingest_applies_rules_and_dedups(queue):
    first = cli.run("ingest", {"source": "gmail", "threads": {"threads": [thread()]}}, queue, actions.Clients())
    again = cli.run("ingest", {"source": "gmail", "threads": [thread()]}, queue, actions.Clients())
    assert first["items"][0]["new"] is True and first["items"][0]["level"] in ("normal", "quiet", "high", "critical")
    assert again["items"][0]["new"] is False and again["items"][0]["num"] == first["items"][0]["num"]


def test_lease_one_window_at_a_time(queue):
    assert queue.lease("gmail-connector", "a", 90, now=100)["granted"] is True
    assert queue.lease("gmail-connector", "b", 90, now=150)["granted"] is False
    assert queue.lease("gmail-connector", "a", 90, now=180)["granted"] is True  # renew
    assert queue.lease("gmail-connector", "b", 90, now=300)["granted"] is True  # a went quiet


def test_connector_send_plan_guards(queue):
    cli.run("ingest", {"source": "gmail", "threads": [thread()]}, queue, actions.Clients())
    item = queue.get("gmail:m1")
    target = actions.describe_target(item, False, "")
    with pytest.raises(actions.SendBlocked) as err:
        actions.connector_send_plan(queue, item.id, "hi", "k1", "Gmail · to someone@else.com · Re: x")
    assert err.value.code == "wrong_recipient"
    plan = actions.connector_send_plan(queue, item.id, " Thanks! ", "k1", target)
    assert plan["plan"] == {"message_id": "m1", "thread_id": "t1", "reply_all": False, "text": "Thanks!", "target": target}
    with pytest.raises(actions.SendBlocked) as err:
        actions.connector_send_plan(queue, item.id, "Thanks!", "k1", target)
    assert err.value.code == "duplicate"
    done = actions.connector_send_done(queue, item.id, "k1", {"id": "sent1"})
    assert done["ok"] and queue.get(item.id).read and queue.get_action(done["action_id"])["detail"]["via"] == "connector"


def test_connector_failed_send_can_retry(queue):
    cli.run("ingest", {"source": "gmail", "threads": [thread()]}, queue, actions.Clients())
    item = queue.get("gmail:m1")
    target = actions.describe_target(item, False, "")
    actions.connector_send_plan(queue, item.id, "hi", "k2", target)
    actions.connector_send_failed(queue, "k2", "check_failed", "Gmail asked us to wait")
    assert actions.connector_send_plan(queue, item.id, "hi", "k2", target)["ok"]


def test_connector_rule_reply_is_held_to_the_cap(queue):
    cli.run("ingest", {"source": "gmail", "threads": [thread()]}, queue, actions.Clients())
    item = queue.get("gmail:m1")
    target = actions.describe_target(item, False, "")
    actions.connector_send_plan(queue, item.id, "Tuesday works.", "auto:r1:a", target, rule="Sara", cap=1)
    actions.connector_send_done(queue, item.id, "auto:r1:a", {"id": "s1"}, rule="Sara")
    with pytest.raises(actions.SendBlocked) as err:
        actions.connector_send_plan(queue, item.id, "Wednesday too.", "auto:r1:b", target, rule="Sara", cap=1)
    assert err.value.code == "cap"


def test_direct_send_refuses_connector_items(queue):
    cli.run("ingest", {"source": "gmail", "threads": [thread()]}, queue, actions.Clients())
    with pytest.raises(actions.SendBlocked) as err:
        actions.send_reply(queue, "gmail:m1", "hi", clients=actions.Clients(), idempotency_key="k")
    assert err.value.code == "use_connector"


def test_modes_and_safety_commands(queue):
    assert cli.run("modes", {}, queue, actions.Clients()) == {"gmail": "", "slack": "direct"}
    cli.run("set_mode", {"source": "gmail", "mode": "connector"}, queue, actions.Clients())
    assert cli.run("modes", {}, queue, actions.Clients())["gmail"] == "connector"
    with pytest.raises(ValueError):
        cli.run("set_mode", {"source": "slack", "mode": "connector"}, queue, actions.Clients())
    safety.RateGuard(queue, "gmail").auth_failed("x")
    assert cli.run("safety", {}, queue, actions.Clients())["sources"]["gmail"]["state"] == "auth"
    cli.run("resume", {"source": "gmail"}, queue, actions.Clients())
    assert cli.run("safety", {}, queue, actions.Clients())["sources"]["gmail"]["state"] == "ok"


def test_watcher_streams_what_other_processes_write(tmp_path):
    from watcher import main as watcher_main
    from watcher.items import Item, Person

    events = []

    class Out:
        def emit(self, event):
            events.append(event)

    stop = threading.Event()
    primary = Queue(tmp_path / "q.db")
    w = watcher_main.Watcher(primary, Out(), stop)
    w.ingest(Item(id="slack:D1:1.0", source="slack", kind="dm", sender=Person(name="A"), title="own",
                  received_at="2026-10-03T10:00:00Z"))
    follower = threading.Thread(target=w.follow_others, daemon=True)
    follower.start()
    other = Queue(tmp_path / "q.db")  # the CLI the plugin runs, a separate connection
    cli.run("ingest", {"source": "gmail", "threads": [thread()]}, other, actions.Clients())
    for _ in range(40):
        if any(e["item"]["id"] == "gmail:m1" for e in events if e["type"] == "item"):
            break
        threading.Event().wait(0.1)
    stop.set()
    streamed = [e for e in events if e["type"] == "item"]
    assert [e["item"]["id"] for e in streamed] == ["slack:D1:1.0", "gmail:m1"]  # own item not repeated
    assert streamed[1]["new"] is True and streamed[1]["item"]["via"] == "connector"


def test_redact_covers_every_token_shape():
    from watcher.auth.secrets import redact
    for prefix in ("xoxe-", "xoxs-", "xoxp-", "GOCSPX-", "1//", "gho_", "ya29."):
        assert redact(f"failed with {prefix}SECRET123 here") == f"failed with {prefix}*** here"
