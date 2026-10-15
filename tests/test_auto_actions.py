"""Auto rules on the guarded path (phase 10): the daily cap, archive with Undo, and the agent log."""

import pytest

from watcher import actions, cli
from watcher.actions import Clients, SendBlocked
from tests.test_send_path import FakeSlack, slack_item


def test_a_rule_stops_at_its_daily_cap(queue, slack_events):
    item = slack_item(queue, slack_events)
    fake = FakeSlack(original_text=slack_events["dm"]["text"])
    sent = actions.send_reply(queue, item.id, "On it.", clients=Clients(slack=fake), rule="Replies", cap=1,
                              sleep=lambda s: None)
    assert sent["ok"] and queue.actions(1)[0]["rule"] == "Replies"
    with pytest.raises(SendBlocked) as blocked:
        actions.send_reply(queue, item.id, "Another one.", clients=Clients(slack=fake), rule="Replies", cap=1,
                           sleep=lambda s: None)
    assert blocked.value.code == "cap"
    assert len(fake.posted) == 1
    # Another rule, or a manual send, has its own count.
    assert queue.rule_actions_today("Other") == 0


def test_archive_marks_read_and_undo_puts_it_back(queue, slack_events):
    item = slack_item(queue, slack_events)
    done = actions.archive(queue, item.id, "Not important", 5)
    assert queue.get(item.id).read
    actions.undo(queue, done["action_id"], Clients())
    assert not queue.get(item.id).read
    # The undo entry doesn't count against the cap.
    assert queue.rule_actions_today("Not important") == 1


def test_cli_cap_and_log(queue, slack_events):
    item = slack_item(queue, slack_events)
    logged = cli.run("log", {"ref": item.id, "action": "review", "rule": "Ahmed Raza", "text": "Posted 3 comments"}, queue, Clients())
    assert logged["ok"] and logged["undo"]["type"] == "none"
    assert cli.run("cap", {"rule": "Ahmed Raza", "cap": 1}, queue, Clients()) == {"ok": True, "used": 1, "allowed": False}
    with pytest.raises(SendBlocked):
        cli.run("log", {"ref": item.id, "action": "rm -rf", "rule": "x"}, queue, Clients())


def test_requests_go_to_the_inbox_session_once(queue, slack_events):
    item = slack_item(queue, slack_events)
    asked = cli.run("request", {"ref": item.id, "kind": "draft", "owner": "coding-window"}, queue, Clients())
    taken = cli.run("requests_take", {}, queue, Clients())["requests"]
    assert [one["id"] for one in taken] == [asked["id"]]
    assert cli.run("requests_take", {}, queue, Clients())["requests"] == []  # taken once
    cli.run("drafts_put", {"ref": item.id, "drafts": {"short": "On it.", "detailed": "D", "ask": "A", "ask_label": "Ask a question"}}, queue, Clients())
    cli.run("request_done", {"id": asked["id"]}, queue, Clients())
    assert cli.run("request_get", {"id": asked["id"]}, queue, Clients())["request"]["status"] == "done"
    assert cli.run("drafts_get", {"ref": item.id}, queue, Clients())["drafts"]["short"] == "On it."
    with pytest.raises(SendBlocked):
        cli.run("request", {"ref": item.id, "kind": "send"}, queue, Clients())
