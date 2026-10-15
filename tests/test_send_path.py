"""The guarded send path: wrong recipient, double send, 429, deleted or edited originals."""

import base64
import email

import pytest
from slack_sdk.errors import SlackApiError

from watcher import actions
from watcher.adapters import gmail, slack
from watcher.actions import Clients, SendBlocked


class FakeResponse(dict):
    def __init__(self, status_code=200, headers=None, **data):
        super().__init__(data)
        self.status_code = status_code
        self.headers = headers or {}


class FakeSlack:
    def __init__(self, original_text="Can you review PR #482 before 5pm?", exists=True, rate_limits=0):
        self.original_text = original_text
        self.exists = exists
        self.rate_limits = rate_limits
        self.posted = []
        self.deleted = []

    def _found(self, ts):
        return [{"ts": ts, "user": "U_AHMED", "text": self.original_text}] if self.exists else []

    def conversations_history(self, channel, latest=None, oldest=None, inclusive=None, limit=None):
        return {"messages": self._found(latest)}

    def conversations_replies(self, channel, ts, latest=None, oldest=None, inclusive=None, limit=None):
        return {"messages": self._found(latest)}

    def chat_postMessage(self, **kwargs):
        if self.rate_limits:
            self.rate_limits -= 1
            raise SlackApiError("ratelimited", FakeResponse(429, {"Retry-After": "2"}, ok=False))
        self.posted.append(kwargs)
        return {"channel": kwargs["channel"], "ts": "1759489999.000100"}

    def chat_delete(self, channel, ts):
        self.deleted.append((channel, ts))
        return {"ok": True}


def slack_item(queue, slack_events, event="dm"):
    c = slack.SlackContext(me="U_ME", user_name=lambda uid: ({"U_AHMED": "Ahmed Raza"}.get(uid, uid), ""),
                           channel_name=lambda cid: "acme-devs")
    item, _ = queue.upsert(slack.normalize(slack_events[event], c))
    return item


def test_slack_dm_reply_sends_inline_and_logs_undo(queue, slack_events):
    item = slack_item(queue, slack_events)
    fake = FakeSlack(original_text=slack_events["dm"]["text"])
    target = actions.describe_target(item)
    assert target == "Slack · DM with Ahmed Raza"
    result = actions.send_reply(queue, item.num, "Sure, I'll review it by 4pm.", clients=Clients(slack=fake),
                                idempotency_key="k1", confirm_target=target)
    assert result["ok"] and fake.posted == [{"channel": "D111", "text": "Sure, I'll review it by 4pm."}]
    assert queue.get(item.id).read is True
    action = queue.get_action(result["action_id"])
    assert action["undo"] == {"type": "slack_delete", "channel": "D111", "ts": "1759489999.000100"}
    actions.undo(queue, result["action_id"], Clients(slack=fake))
    assert fake.deleted == [("D111", "1759489999.000100")]


def test_mention_reply_goes_in_thread(queue, slack_events):
    item = slack_item(queue, slack_events, "mention")
    fake = FakeSlack(original_text=slack_events["mention"]["text"])
    assert actions.describe_target(item) == "Slack · #acme-devs · in thread"
    actions.send_reply(queue, item.id, "On it", clients=Clients(slack=fake), idempotency_key="k")
    assert fake.posted[0]["thread_ts"] == slack_events["mention"]["ts"]


def test_wrong_recipient_blocked(queue, slack_events):
    item = slack_item(queue, slack_events)
    fake = FakeSlack(original_text=slack_events["dm"]["text"])
    with pytest.raises(SendBlocked) as err:
        actions.send_reply(queue, item.id, "hi", clients=Clients(slack=fake), idempotency_key="k",
                           confirm_target="Slack · DM with Somebody Else")
    assert err.value.code == "wrong_recipient" and not fake.posted


def test_double_send_blocked(queue, slack_events):
    item = slack_item(queue, slack_events)
    fake = FakeSlack(original_text=slack_events["dm"]["text"])
    actions.send_reply(queue, item.id, "hi", clients=Clients(slack=fake), idempotency_key="same")
    with pytest.raises(SendBlocked) as err:
        actions.send_reply(queue, item.id, "hi", clients=Clients(slack=fake), idempotency_key="same")
    assert err.value.code == "duplicate" and len(fake.posted) == 1
    # No key given: the same text to the same item gets the same derived key.
    with pytest.raises(SendBlocked):
        actions.send_reply(queue, item.id, "again", clients=Clients(slack=fake))
        actions.send_reply(queue, item.id, "again", clients=Clients(slack=fake))
    assert len(fake.posted) == 2


def test_rate_limit_waits_and_retries_once(queue, slack_events):
    item = slack_item(queue, slack_events)
    fake = FakeSlack(original_text=slack_events["dm"]["text"], rate_limits=1)
    waits = []
    result = actions.send_reply(queue, item.id, "hi", clients=Clients(slack=fake), idempotency_key="k",
                                sleep=waits.append)
    assert result["ok"] and waits == [2.0] and len(fake.posted) == 1


def test_rate_limit_twice_gives_up_and_can_retry(queue, slack_events):
    item = slack_item(queue, slack_events)
    fake = FakeSlack(original_text=slack_events["dm"]["text"], rate_limits=2)
    with pytest.raises(SendBlocked) as err:
        actions.send_reply(queue, item.id, "hi", clients=Clients(slack=fake), idempotency_key="k",
                           sleep=lambda s: None)
    assert err.value.code == "rate_limited" and not fake.posted
    # Nothing was sent, so the same key may try again.
    actions.send_reply(queue, item.id, "hi", clients=Clients(slack=fake), idempotency_key="k", sleep=lambda s: None)
    assert len(fake.posted) == 1


def test_original_deleted_blocks(queue, slack_events):
    item = slack_item(queue, slack_events)
    with pytest.raises(SendBlocked) as err:
        actions.send_reply(queue, item.id, "hi", clients=Clients(slack=FakeSlack(exists=False)), idempotency_key="k")
    assert err.value.code == "original_gone"


def test_original_edited_needs_acknowledgement(queue, slack_events):
    item = slack_item(queue, slack_events)
    fake = FakeSlack(original_text="Actually, never mind")
    with pytest.raises(SendBlocked) as err:
        actions.send_reply(queue, item.id, "hi", clients=Clients(slack=fake), idempotency_key="k")
    assert err.value.code == "original_edited" and not fake.posted
    actions.send_reply(queue, item.id, "hi", clients=Clients(slack=fake), idempotency_key="k", ack_changes=True)
    assert len(fake.posted) == 1


def test_slack_length_limit(queue, slack_events):
    item = slack_item(queue, slack_events)
    with pytest.raises(SendBlocked) as err:
        actions.send_reply(queue, item.id, "x" * 40_001, clients=Clients(slack=FakeSlack()), idempotency_key="k")
    assert err.value.code == "too_long"


def test_empty_and_unknown(queue, slack_events):
    item = slack_item(queue, slack_events)
    with pytest.raises(SendBlocked) as err:
        actions.send_reply(queue, item.id, "   ", clients=Clients(slack=FakeSlack()))
    assert err.value.code == "empty"
    with pytest.raises(SendBlocked) as err:
        actions.send_reply(queue, 999, "hi", clients=Clients(slack=FakeSlack()))
    assert err.value.code == "not_found"


def test_excluded_items_never_reach_claude(queue, slack_events):
    item = slack_item(queue, slack_events)
    item.excluded = True
    queue.upsert(item)
    result = actions.get_thread(queue, item.id, Clients(slack=FakeSlack()))
    assert result["excluded"] is True and "messages" not in result


# ---- Gmail -----------------------------------------------------------------------


class FakeGmail:
    """users().messages().send / get, drafts().create, chained like googleapiclient."""

    def __init__(self):
        self.sent = []
        self.created_drafts = []

    def users(self):
        return self

    def messages(self):
        return self

    def drafts(self):
        outer = self

        class Drafts:
            def create(self, userId, body):
                outer.created_drafts.append(body)
                return _Exec({"id": "d1"})

        return Drafts()

    def get(self, userId, id, format):
        return _Exec({"id": id, "labelIds": ["INBOX"]})

    def send(self, userId, body):
        self.sent.append(body)
        return _Exec({"id": "sent1", "threadId": body["threadId"]})


class _Exec:
    def __init__(self, value):
        self.value = value

    def execute(self):
        return self.value


def test_gmail_reply_threads_correctly(queue, gmail_messages):
    item, _ = queue.upsert(gmail.normalize(gmail_messages["inbox"], "alex@example.com"))
    fake = FakeGmail()
    clients = Clients(gmail=fake, gmail_me="alex@example.com")
    target = actions.describe_target(item, False, "alex@example.com")
    assert target == "Gmail · to sara@example.com · Re: Q4 roadmap review, slides attached"
    result = actions.send_reply(queue, item.id, "Thanks, will look today.", clients=clients,
                                idempotency_key="g1", confirm_target=target)
    assert result["ok"] and result["undo"]["type"] == "none"
    body = fake.sent[0]
    assert body["threadId"] == "t1"
    mime = email.message_from_bytes(base64.urlsafe_b64decode(body["raw"]))
    assert mime["To"] == "sara@example.com"
    assert mime["Subject"] == "Re: Q4 roadmap review, slides attached"
    assert mime["In-Reply-To"] == "<abc123@mail.example.com>"
    assert mime["References"] == "<prev@mail.example.com> <abc123@mail.example.com>"


def test_gmail_reply_all_excludes_me(queue, gmail_messages):
    item, _ = queue.upsert(gmail.normalize(gmail_messages["inbox"], "alex@example.com"))
    to, cc = actions.gmail_recipients(item, "alex@example.com", reply_all=True)
    assert to == ["sara@example.com", "team@example.com"] and cc == ["lead@example.com"]


def test_gmail_draft(queue, gmail_messages):
    item, _ = queue.upsert(gmail.normalize(gmail_messages["inbox"], "alex@example.com"))
    fake = FakeGmail()
    result = actions.save_draft(queue, item.id, "draft text", Clients(gmail=fake, gmail_me="alex@example.com"))
    assert result["where"] == "Gmail Drafts" and fake.created_drafts[0]["message"]["threadId"] == "t1"
    assert queue.get_draft(item.id) == "draft text"


def test_demo_items_never_touch_the_network(queue):
    from watcher import demo

    item, _ = queue.upsert(demo.backlog()[1])
    result = actions.send_reply(queue, item.id, "hi", clients=Clients(), idempotency_key="d")
    assert result["ok"] and result["demo"] is True
