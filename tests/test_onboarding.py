"""In-app setup: clipboard tokens, Gmail client discovery, Pub/Sub push setup, status."""

import json
import os
from pathlib import Path

import pytest

from watcher.auth import __main__ as auth_cli
from watcher.auth import clipboard, google, secrets, slack


class Exec:
    def __init__(self, value=None, error=None):
        self.value, self.error = value, error

    def execute(self):
        if self.error:
            raise self.error
        return self.value


def http_error(status, text="error"):
    from googleapiclient.errors import HttpError

    class Resp(dict):
        def __init__(self):
            super().__init__()
            self.status = status
            self.reason = text

    return HttpError(Resp(), text.encode())


# ---- Slack tokens --------------------------------------------------------------------


def test_wrong_token_kind_is_refused_without_echoing_it():
    with pytest.raises(slack.SlackAuthError) as err:
        slack.store_one("user", "xapp-1-SECRETVALUE")
    assert "xoxp-" in str(err.value) and "SECRETVALUE" not in str(err.value)
    assert secrets.get("slack_user_token") is None


def test_app_token_stored_after_check(monkeypatch):
    monkeypatch.setattr(slack, "check_app_token", lambda token: None)
    assert slack.store_one("app", "  xapp-1-abc \n") == "Slack app-level token saved."
    assert secrets.get("slack_app_token") == "xapp-1-abc"
    assert slack.connected() == {"user": False, "app": True}


def test_connect_from_clipboard_clears_it(monkeypatch, capsys):
    board = {"value": "xoxp-123"}
    monkeypatch.setattr(clipboard, "read", lambda: board["value"])
    monkeypatch.setattr(clipboard, "clear_if", lambda value: board.update(value="") if board["value"] == value else None)
    monkeypatch.setattr(slack, "check", lambda token: {"user": "alex", "team": "Acme", "missing_scopes": []})
    code = auth_cli.main(["connect-slack", "--kind", "user", "--from-clipboard", "--json"])
    out = json.loads(capsys.readouterr().out)
    assert code == 0 and out["ok"] and "xoxp-123" not in json.dumps(out)
    assert board["value"] == "" and secrets.get("slack_user_token") == "xoxp-123"


def test_clipboard_with_something_else(monkeypatch, capsys):
    monkeypatch.setattr(clipboard, "read", lambda: "hello world")
    code = auth_cli.main(["connect-slack", "--kind", "app", "--from-clipboard", "--json"])
    out = json.loads(capsys.readouterr().out)
    assert code == 1 and "xapp-" in out["error"] and "hello world" not in out["error"]


def test_clipboard_clear_only_when_unchanged(monkeypatch):
    calls = []
    monkeypatch.setattr(clipboard, "read", lambda: "other")
    monkeypatch.setattr(clipboard.subprocess, "run", lambda *a, **k: calls.append(a))
    clipboard.clear_if("xoxp-1")
    assert calls == []


# ---- Gmail -----------------------------------------------------------------------------


def client_json(project="arbi-proj"):
    return json.dumps({"installed": {"client_id": "id.apps.googleusercontent.com", "client_secret": "s",
                                     "project_id": project, "redirect_uris": ["http://localhost"],
                                     "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                                     "token_uri": "https://oauth2.googleapis.com/token"}})


def test_client_json_found_in_downloads(tmp_path, monkeypatch):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    downloads = tmp_path / "Downloads"
    downloads.mkdir()
    (downloads / "client_secret_web.json").write_text(json.dumps({"web": {"client_id": "x"}}))  # wrong type
    good = downloads / "client_secret_123.json"
    good.write_text(client_json())
    os.utime(downloads / "client_secret_web.json", (1, 1))
    assert google.find_client_secrets() == good
    stored = google.adopt_client(good)
    assert stored == google.stored_client_path() and oct(stored.stat().st_mode)[-3:] == "600"
    assert google.project_id() == "arbi-proj"


def test_no_client_json_gives_the_fix(tmp_path, monkeypatch):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    with pytest.raises(google.GoogleAuthError) as err:
        google.sign_in()
    assert "Desktop app" in str(err.value)


class FakePubSub:
    def __init__(self, exists=False, policy=None):
        self.exists = exists
        self.policy = policy or {}
        self.set_policies = []
        self.created_subs = []

    def projects(self):
        return self

    def topics(self):
        outer = self

        class Topics:
            def create(self, name, body):
                return Exec(error=http_error(409) if outer.exists else None, value={"name": name})

            def getIamPolicy(self, resource):
                return Exec(json.loads(json.dumps(outer.policy)))

            def setIamPolicy(self, resource, body):
                outer.set_policies.append(body["policy"])
                return Exec(body["policy"])

        return Topics()

    def subscriptions(self):
        outer = self

        class Subs:
            def create(self, name, body):
                outer.created_subs.append((name, body))
                return Exec(error=http_error(409) if outer.exists else None, value={"name": name})

        return Subs()


def test_pubsub_setup_creates_topic_permission_and_subscription():
    fake = FakePubSub()
    names = google.setup_pubsub(None, "arbi-proj", service=fake)
    assert names == {"GMAIL_PUBSUB_TOPIC": "projects/arbi-proj/topics/switchboard-gmail",
                     "GMAIL_PUBSUB_SUBSCRIPTION": "projects/arbi-proj/subscriptions/switchboard-gmail-pull"}
    binding = fake.set_policies[0]["bindings"][0]
    assert binding == {"role": "roles/pubsub.publisher", "members": [google.GMAIL_PUSH_ACCOUNT]}
    assert fake.created_subs[0][1]["topic"] == names["GMAIL_PUBSUB_TOPIC"]


def test_pubsub_setup_is_idempotent_and_keeps_other_members():
    fake = FakePubSub(exists=True, policy={"bindings": [{"role": "roles/pubsub.publisher", "members": ["user:a@x.com"]}]})
    google.setup_pubsub(None, "p", service=fake)
    assert fake.set_policies[0]["bindings"][0]["members"] == ["user:a@x.com", google.GMAIL_PUSH_ACCOUNT]


def test_connect_falls_back_to_polling_when_pubsub_is_disabled(monkeypatch):
    monkeypatch.setattr(google, "sign_in", lambda path=None: "keychain")
    monkeypatch.setattr(google, "credentials", lambda: object())
    monkeypatch.setattr(google, "project_id", lambda: "arbi-proj")

    def disabled(creds, project, service=None):
        raise RuntimeError("Cloud Pub/Sub API has not been used in project arbi-proj before or it is disabled")

    monkeypatch.setattr(google, "setup_pubsub", disabled)
    result = google.connect()
    assert result["ok"] and result["push"] is False
    assert "pubsub.googleapis.com?project=arbi-proj" in result["message"]
    assert secrets.config_value("GMAIL_PUBSUB_TOPIC") is None


def test_connect_saves_push_config(monkeypatch):
    monkeypatch.setattr(google, "sign_in", lambda path=None: "keychain")
    monkeypatch.setattr(google, "credentials", lambda: object())
    monkeypatch.setattr(google, "project_id", lambda: "p")
    monkeypatch.setattr(google, "setup_pubsub", lambda c, p, service=None: {"GMAIL_PUBSUB_TOPIC": "t", "GMAIL_PUBSUB_SUBSCRIPTION": "s"})
    assert google.connect()["push"] is True
    assert secrets.config_value("GMAIL_PUBSUB_SUBSCRIPTION") == "s"


# ---- status and the watcher's setup state ----------------------------------------------------


def test_status_json_is_fast_and_has_links(capsys):
    assert auth_cli.main(["status", "--json"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["slack"] == {"user": False, "app": False}
    assert out["gmail"]["signed_in"] is False
    assert out["links"]["slack_new_app"].startswith("https://api.slack.com/apps?new_app=1")
    assert len(out["links"]["slack_new_app"]) <= 2048


def test_watcher_reports_not_connected_as_setup(monkeypatch):
    import threading

    from watcher import main as watcher_main

    events = []

    class Out:
        def emit(self, event):
            events.append(event)

    w = watcher_main.Watcher.__new__(watcher_main.Watcher)
    w.out, w.stop = Out(), threading.Event()

    def factory():
        raise slack.NotConnected("Slack is not connected yet. Open /inbox to connect it.")

    w.start_adapter("slack", factory)
    for _ in range(50):
        if events:
            break
        threading.Event().wait(0.01)
    assert events[0]["state"] == "setup"
