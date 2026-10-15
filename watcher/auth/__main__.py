"""Connect sources.

The Inbox pane drives these with --json; they also work by hand in a terminal:

    python -m watcher.auth slack                      paste both tokens (hidden input)
    python -m watcher.auth connect-slack --kind user --from-clipboard
    python -m watcher.auth google [--client-secrets PATH]
    python -m watcher.auth status [--json]
    python -m watcher.auth logout slack|google

Tokens are never printed; they go to the OS keychain.
"""

from __future__ import annotations

import argparse
import getpass
import json
import sys
from typing import Any
from urllib.parse import quote

from .. import paths
from . import clipboard, google, secrets, slack

SLACK_NEW_APP = "https://api.slack.com/apps?new_app=1"
LINK_LIMIT = 2048


def slack_manifest_url() -> str:
    """A link that opens Slack's Create App dialog with the manifest filled in."""
    import yaml

    manifest = yaml.safe_load((paths.REPO_ROOT / "config" / "slack-app-manifest.yaml").read_text())
    url = f"{SLACK_NEW_APP}&manifest_json={quote(json.dumps(manifest, separators=(',', ':')), safe='')}"
    return url if len(url) <= LINK_LIMIT else SLACK_NEW_APP


def status() -> dict[str, Any]:
    """What is connected, how, and each source's safety state: local state only (no network)."""
    from .. import modes
    from ..queue import Queue
    from ..safety import RateGuard

    queue = Queue()
    safety = {name: RateGuard(queue, name).status() for name in ("slack", "slack-connect", "gmail")}
    worst = {"ok": 0, "backoff": 1, "paused": 2, "auth": 3}
    slack_connect = safety.pop("slack-connect")
    if worst.get(slack_connect["state"], 0) > worst.get(safety["slack"]["state"], 0):
        safety["slack"] = slack_connect
    queue.close()
    return {
        "modes": {source: modes.mode(source) for source in modes.MODES},
        "safety": safety,
        "slack": slack.connected(),
        "gmail": google.connected(),
        "links": {
            "slack_new_app": slack_manifest_url(),
            "slack_apps": "https://api.slack.com/apps",
            "gmail_api": "https://console.cloud.google.com/apis/library/gmail.googleapis.com",
            "oauth_client": "https://console.cloud.google.com/apis/credentials",
        },
    }


def emit(result: dict[str, Any], as_json: bool) -> int:
    if as_json:
        print(json.dumps(result, ensure_ascii=False))
    else:
        mark = "✓" if result.get("ok") else "✗"
        print(f"{mark} {result.get('message') or result.get('error')}", file=sys.stdout if result.get("ok") else sys.stderr)
    return 0 if result.get("ok") else 1


def cmd_slack(_: argparse.Namespace) -> int:
    print("Paste the Slack tokens from your app's settings page (input is hidden).")
    app_token = getpass.getpass("App-level token (xapp-…): ").strip()
    user_token = getpass.getpass("User OAuth token (xoxp-…): ").strip()
    try:
        messages = [slack.store_one("app", app_token), slack.store_one("user", user_token)]
    except slack.SlackAuthError as exc:
        return emit({"ok": False, "error": str(exc)}, False)
    return emit({"ok": True, "message": " ".join(messages)}, False)


def _resume(source: str) -> None:
    """A fresh connection clears that source's safety stop (e.g. a rejected token)."""
    from ..queue import Queue
    from ..safety import RateGuard

    queue = Queue()
    for name in {"slack": ("slack", "slack-connect"), "google": ("gmail",)}[source]:
        RateGuard(queue, name).resume()
    queue.close()


def cmd_connect_slack(args: argparse.Namespace) -> int:
    try:
        token = clipboard.read() if args.from_clipboard else getpass.getpass(f"Slack {args.kind} token: ")
        message = slack.store_one(args.kind, token)
    except (slack.SlackAuthError, clipboard.ClipboardUnavailable) as exc:
        return emit({"ok": False, "error": secrets.redact(str(exc))}, args.json)
    except Exception as exc:  # network trouble
        return emit({"ok": False, "error": f"Could not reach Slack: {secrets.redact(str(exc))[:200]}"}, args.json)
    if args.from_clipboard:
        clipboard.clear_if(token)
    _resume("slack")
    return emit({"ok": True, "message": message, "slack": slack.connected()}, args.json)


def cmd_google(args: argparse.Namespace) -> int:
    try:
        result = google.connect(args.client_secrets)
        _resume("google")
        from .. import modes

        modes.set_mode("gmail", "direct")
    except google.GoogleAuthError as exc:
        return emit({"ok": False, "error": str(exc)}, args.json)
    except Exception as exc:
        return emit({"ok": False, "error": f"Gmail setup failed: {secrets.redact(str(exc))[:300]}"}, args.json)
    return emit({**result, "gmail": google.connected()}, args.json)


def cmd_status(args: argparse.Namespace) -> int:
    if args.json:
        print(json.dumps({"ok": True, **status()}))
        return 0
    rows = []
    try:
        _, user_token = slack.tokens()
        info = slack.check(user_token)
        rows.append(("Slack", f"connected as {info['user']} ({info['team']})"))
    except Exception as exc:
        rows.append(("Slack", secrets.redact(str(exc))))
    try:
        google.credentials()
        push = secrets.config_value("GMAIL_PUBSUB_SUBSCRIPTION")
        rows.append(("Gmail", "connected" + ("" if push else " · no Pub/Sub push, checking every 60 s")))
    except Exception as exc:
        rows.append(("Gmail", secrets.redact(str(exc))))
    for name, state in rows:
        print(f"{name:<6} {state}")
    return 0


def cmd_logout(args: argparse.Namespace) -> int:
    names = {"slack": ["slack_app_token", "slack_user_token"], "google": ["google_token"]}[args.source]
    for name in names:
        secrets.delete(name)
    _resume(args.source)
    print(f"Removed {args.source} tokens from the keychain.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m watcher.auth")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("slack", help="store both Slack tokens (hidden input)").set_defaults(fn=cmd_slack)
    cs = sub.add_parser("connect-slack", help="store one Slack token")
    cs.add_argument("--kind", choices=["user", "app"], required=True)
    cs.add_argument("--from-clipboard", action="store_true", help="read the token from the clipboard, then clear it")
    cs.add_argument("--json", action="store_true")
    cs.set_defaults(fn=cmd_connect_slack)
    g = sub.add_parser("google", help="Google sign-in for Gmail, then Pub/Sub push setup")
    g.add_argument("--client-secrets", help="path to the OAuth client JSON (default: found in Downloads)")
    g.add_argument("--json", action="store_true")
    g.set_defaults(fn=cmd_google)
    st = sub.add_parser("status", help="what is connected")
    st.add_argument("--json", action="store_true")
    st.set_defaults(fn=cmd_status)
    lo = sub.add_parser("logout", help="remove a source's tokens")
    lo.add_argument("source", choices=["slack", "google"])
    lo.set_defaults(fn=cmd_logout)
    args = parser.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
