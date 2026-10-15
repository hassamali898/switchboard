from watcher.adapters import gmail, slack


def ctx(**kw):
    names = {"U_AHMED": ("Ahmed Raza", "ahmed@example.com"), "U_BILAL": ("Bilal Ahmed", ""), "U_ME": ("Alex", "")}
    defaults = dict(me="U_ME", user_name=lambda uid: names.get(uid, (uid, "")),
                    channel_name=lambda cid: {"C222": "acme-devs"}.get(cid, cid))
    defaults.update(kw)
    return slack.SlackContext(**defaults)


# ---- Slack ---------------------------------------------------------------------


def test_slack_dm(slack_events):
    item = slack.normalize(slack_events["dm"], ctx())
    assert item.id == "slack:D111:1759480000.000100"
    assert item.kind == "dm"
    assert item.sender.name == "Ahmed Raza"
    assert item.body.endswith("session store migration.")  # link label kept, markup gone
    assert item.meta["channel"] == "D111" and item.meta["thread_ts"] == ""
    assert item.received_at.startswith("2025-10-03T")


def test_slack_mention_resolves_names(slack_events):
    item = slack.normalize(slack_events["mention"], ctx())
    assert item.kind == "mention"
    assert item.title == "@Alex deploy is blocked on your review"
    assert item.meta["channel_name"] == "acme-devs"


def test_slack_channel_noise_skipped(slack_events):
    assert slack.normalize(slack_events["channel_noise"], ctx()) is None


def test_slack_thread_only_after_you_posted(slack_events):
    c = ctx()
    assert slack.normalize(slack_events["thread_reply"], c) is None
    assert slack.note_own_message(slack_events["own"], c) == "C222:1759480200.000400"
    assert slack.normalize(slack_events["own"], c) is None  # your own message never becomes an item
    item = slack.normalize(slack_events["thread_reply"], c)
    assert item.kind == "thread"
    assert item.meta["thread_ts"] == "1759480200.000400"


def test_slack_bots_skipped(slack_events):
    assert slack.normalize(slack_events["bot"], ctx()) is None


def test_slack_edit_updates_same_item(slack_events):
    original = slack.normalize(slack_events["dm"], ctx())
    edited = slack.normalize(slack_events["edited"], ctx())
    assert edited.id == original.id
    assert "6pm" in edited.body
    assert edited.meta["edited"] is True
    assert edited.meta["text_hash"] != original.meta["text_hash"]


def test_slack_scope_dms_only(slack_events):
    c = ctx(watch=["dms"])
    assert slack.normalize(slack_events["mention"], c) is None
    assert slack.normalize(slack_events["dm"], c) is not None


# ---- Gmail ---------------------------------------------------------------------


def test_gmail_inbox_message(gmail_messages):
    item = gmail.normalize(gmail_messages["inbox"], "alex@example.com")
    assert item.id == "gmail:m1"
    assert item.kind == "mail"
    assert item.sender.name == "Sara Khan" and item.sender.email == "sara@example.com"
    assert item.title == "Q4 roadmap review, slides attached"
    assert "Attached are the Q4 roadmap slides." in item.body
    assert "old text" not in item.body  # quoted chain stripped
    assert item.meta["files"] == ["Q4-roadmap.pdf"]
    assert item.meta["message_id"] == "<abc123@mail.example.com>"
    assert item.thread.id == "t1"


def test_gmail_html_only_body(gmail_messages):
    item = gmail.normalize(gmail_messages["html_only"], "alex@example.com")
    assert "Hello" in item.body and "<p>" not in item.body and "p{}" not in item.body


def test_gmail_skips_sent_and_own(gmail_messages):
    assert gmail.normalize(gmail_messages["sent"], "alex@example.com") is None
    assert gmail.normalize(gmail_messages["from_me_inbox"], "Alex@Example.com") is None
