"""Calendar, GitHub and Jira connector records → items (fixtures are shaped like the connectors' answers)."""

from watcher.connectors import calendar_item, github_item, jira_item, https

MEET = {"id": "ev1", "summary": "Sprint planning", "status": "confirmed",
        "start": {"dateTime": "2026-10-12T11:30:00+05:00", "timeZone": "Etc/GMT-5"},
        "end": {"dateTime": "2026-10-12T12:00:00+05:00"}, "hangoutLink": "https://meet.google.com/abc-defg-hij",
        "htmlLink": "https://calendar.google.com/event?eid=1",
        "attendees": [{"email": "me@x.com", "responseStatus": "accepted"}, {"email": "ahmed@x.com", "displayName": "Ahmed"}]}


def test_timed_event_becomes_meeting_with_https_join():
    item = calendar_item(MEET, "me@x.com")
    assert item and item.source == "calendar" and item.kind == "meeting" and item.level == "normal"
    assert item.meta["join_url"] == "https://meet.google.com/abc-defg-hij"
    assert item.meta["starts_at"] == "2026-10-12T06:30:00Z"  # 11:30+05:00; ISO, as the pane reads it
    assert item.meta["attendees"] == ["me@x.com", "Ahmed"]


def test_declined_cancelled_all_day_and_unsafe_links_are_handled():
    assert calendar_item({**MEET, "attendees": [{"email": "me@x.com", "responseStatus": "declined"}]}, "me@x.com") is None
    assert calendar_item({**MEET, "status": "cancelled"}, "me@x.com") is None
    assert calendar_item({"id": "d", "summary": "Holiday", "start": {"date": "2026-10-12"}, "end": {"date": "2026-10-13"}}) is None
    unsafe = calendar_item({**MEET, "hangoutLink": "http://insecure.example/join"}, "me@x.com")
    assert unsafe and unsafe.meta["join_url"] == ""
    assert https("javascript:alert(1)") == ""


def test_github_review_request_and_passing_ci_are_told_apart():
    review = github_item({"id": "9", "reason": "review_requested", "updated_at": "2026-10-12T08:00:00Z",
                          "subject": {"title": "Add session store", "type": "PullRequest", "url": "https://api.github.com/x"},
                          "repository": {"full_name": "acme/web-api"}, "html_url": "https://github.com/acme/web-api/pull/482"})
    assert review and review.kind == "review_request" and review.level == "high"
    assert review.title == "Add session store" and review.meta["repo"] == "acme/web-api"
    assert github_item({"id": "10", "reason": "ci_activity", "subject": {"title": "CI passed"}, "repository": {"full_name": "a/b"}}) is None
    assert github_item({"id": "11", "reason": "subscribed", "subject": {"title": "x"}}) is None
    failed = github_item({"id": "12", "reason": "ci_activity", "subject": {"title": "Build failed on main"}, "repository": {"full_name": "a/b"}})
    assert failed and failed.kind == "ci_failed"


def test_jira_assigned_to_you_and_done_issues():
    issue = {"key": "ACME-1290", "fields": {"summary": "Safari login loop", "status": {"name": "In Progress"},
             "assignee": {"displayName": "Alex Doe"}, "updated": "2026-10-12T09:00:00.000+0000"}, "url": "https://acme.atlassian.net/browse/ACME-1290"}
    item = jira_item(issue, "Alex Doe")
    assert item and item.kind == "assigned" and item.title == "Safari login loop" and item.url.startswith("https://")
    assert jira_item({**issue, "fields": {**issue["fields"], "status": {"name": "Done"}}}, "Alex Doe") is None


def test_jira_from_atlassians_connector_shape():
    """Atlassian's searchJiraIssuesUsingJql: webUrl, a reporter, and a status category (checked 2026-10-12)."""
    issue = {"key": "ACME-2919", "webUrl": "https://example.atlassian.net/browse/ACME-2919",
             "fields": {"summary": "Fix the export", "updated": "2026-10-12T09:00:00.000+0500",
                        "reporter": {"displayName": "Sara Khan"},
                        "status": {"name": "In Progress", "statusCategory": {"key": "indeterminate"}}}}
    item = jira_item(issue, "", assigned=True)
    assert (item.kind, item.sender.name, item.url) == ("assigned", "Sara Khan", "https://example.atlassian.net/browse/ACME-2919")
    done = {**issue, "fields": {**issue["fields"], "status": {"name": "Shipped", "statusCategory": {"key": "done"}}}}
    assert jira_item(done, "", assigned=True) is None


SLACK_SEARCH = """# Search Results for: \\n\\n## Messages (2 results)
### Result 1 of 2
Channel: DM (ID: D0DEMODM01)
Participants: Alex Doe (ID: U0DEMOME01), Code Review (ID: U0DEMOBOT1)
From: Code Review (ID: U0DEMOBOT1)  [BOT]
Time: 2026-10-09 14:00:00 UTC
Message_ts: 1791500000.000100
Permalink: [link](https:\\/\\/example.slack.com\\/archives\\/D0DEMODM01\\/p1791500000000100)
Text: 
Your code review request had been marked as complete

---

### Result 2 of 2
Channel: #acme-devs (ID: C0DEMOCHN1)
From: Sara Khan (ID: U0DEMOSARA) 
Time: 2026-10-09 14:10:00 UTC
Message_ts: 1791500600.000200
Permalink: [link](https:\\/\\/example.slack.com\\/archives\\/C0DEMOCHN1\\/p1791500600000200)
Text: 
<@U0DEMOME01|Alex Doe> can you check <https://example.com/pr/1|the PR>?

---
"""


def test_slack_connector_markdown_becomes_items():
    """The live connector's Markdown (shape checked 2026-10-12): bots skipped, a mention kept, links readable."""
    from watcher.connectors import slack_item, slack_results

    records = slack_results(SLACK_SEARCH)
    assert [r["message_ts"] for r in records] == ["1791500000.000100", "1791500600.000200"]
    items = [slack_item(r, "U0DEMOME01", "mention") for r in records]
    assert items[0] is None  # a bot
    item = items[1]
    assert (item.id, item.kind, item.sender.name, item.level) == ("slack:C0DEMOCHN1:1791500600.000200", "mention", "Sara Khan", "high")
    assert item.body == "@Alex Doe can you check the PR (https://example.com/pr/1)?"
    assert item.url == "https://example.slack.com/archives/C0DEMOCHN1/p1791500600000200"
    assert item.meta["channel_name"] == "acme-devs"


def test_calendar_event_from_the_live_shape():
    from watcher.connectors import calendar_item

    event = {"id": "e1", "summary": "Team standup", "status": "confirmed", "start": {"dateTime": "2026-10-13T10:00:00+05:00"},
             "end": {"dateTime": "2026-10-13T10:15:00+05:00"}, "conferenceUrl": "https://meet.google.com/abc-defg-hij",
             "attendees": [{"email": "a@x.com", "responseStatus": "accepted"}, {"email": "me@x.com", "responseStatus": "needsAction", "self": True}]}
    item = calendar_item(event, "")
    assert (item.level, item.meta["join_url"], item.meta["attendees"]) == ("normal", "https://meet.google.com/abc-defg-hij", ["a@x.com"])
    declined = {**event, "attendees": [{"email": "me@x.com", "responseStatus": "declined", "self": True}]}
    assert calendar_item(declined, "") is None


def test_times_never_vanish_or_crash():
    from watcher import connectors
    assert connectors.received(0) and connectors.received(1e17)  # unknown or absurd: now, not "" (archived at once)
    assert connectors._epoch("2026-10-12T10:00:00.000+0000") == connectors._epoch("2026-10-12T10:00:00+00:00")
    item = connectors.github_item({"id": "1", "reason": "mention", "subject": {"title": "x"}})
    assert item and item.received_at
