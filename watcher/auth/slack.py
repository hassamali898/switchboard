"""Slack tokens from "Install to Workspace": xapp- (Socket Mode) and xoxp- (user token)."""

from __future__ import annotations

from typing import Any

from . import secrets

USER_SCOPES = [
    "im:history", "mpim:history", "channels:history", "groups:history",
    "chat:write", "users:read", "users:read.email",
]


class SlackAuthError(RuntimeError):
    """Raised with a user-facing fix ("Reconnect Slack: ...")."""


class NotConnected(SlackAuthError):
    """No tokens yet: the pane shows the Connect Slack steps instead of an error."""


PREFIX = {"user": "xoxp-", "app": "xapp-"}
KEY = {"user": "slack_user_token", "app": "slack_app_token"}


def tokens() -> tuple[str, str]:
    app_token = secrets.get("slack_app_token")
    user_token = secrets.get("slack_user_token")
    if not app_token or not user_token:
        raise NotConnected("Slack is not connected yet. Connect it in Switchboard's Settings (/sb-inbox).")
    return app_token, user_token


def connected() -> dict[str, bool]:
    return {"user": bool(secrets.get("slack_user_token")), "app": bool(secrets.get("slack_app_token"))}


def check_app_token(app_token: str) -> None:
    """apps.connections.open proves the xapp- token can open Socket Mode."""
    from slack_sdk import WebClient
    from slack_sdk.errors import SlackApiError

    try:
        WebClient().apps_connections_open(app_token=app_token)
    except SlackApiError as exc:
        error = exc.response.get("error", "unknown_error")
        raise SlackAuthError(
            f"Slack refused the app-level token ({error}). Generate one under Basic Information → "
            "App-Level Tokens with the connections:write scope, and make sure Socket Mode is on."
        ) from exc


def store_one(kind: str, token: str) -> str:
    """Validates and stores one token (`user` xoxp- or `app` xapp-). Returns a message without it."""
    token = token.strip()
    prefix = PREFIX[kind]
    if not token.startswith(prefix):
        where = ("OAuth & Permissions → User OAuth Token" if kind == "user"
                 else "Basic Information → App-Level Tokens")
        raise SlackAuthError(f"That isn't a Slack {kind} token (it should start with {prefix}). "
                             f"Copy it from {where}, then try again.")
    if kind == "user":
        info = check(token)
        secrets.set(KEY[kind], token)
        message = f"Slack user token saved for {info['user']} in {info['team']}."
        if info["missing_scopes"]:
            message += (" Missing scopes: " + ", ".join(info["missing_scopes"]) +
                        ". Add them under OAuth & Permissions → User Token Scopes and reinstall the app.")
        return message
    check_app_token(token)
    secrets.set(KEY[kind], token)
    return "Slack app-level token saved."


def check(user_token: str) -> dict[str, Any]:
    """auth.test plus a scope check. Returns {user_id, user, team, missing_scopes}."""
    from slack_sdk import WebClient
    from slack_sdk.errors import SlackApiError

    client = WebClient(token=user_token)
    try:
        resp = client.auth_test()
    except SlackApiError as exc:
        error = exc.response.get("error", "unknown_error")
        if error in ("invalid_auth", "token_revoked", "account_inactive", "not_authed"):
            raise SlackAuthError(
                f"Reconnect Slack: the user token was rejected ({error}). Reinstall the app "
                "to the workspace and paste the new token in Switchboard's Settings."
            ) from exc
        raise
    granted = set((resp.headers.get("x-oauth-scopes") or "").replace(" ", "").split(",")) - {""}
    return {
        "user_id": resp["user_id"],
        "user": resp["user"],
        "team": resp["team"],
        "missing_scopes": sorted(set(USER_SCOPES) - granted) if granted else [],
    }


def store(app_token: str, user_token: str) -> str:
    if not app_token.startswith("xapp-"):
        raise SlackAuthError("The app-level token must start with xapp- (Basic Information → App-Level Tokens, scope connections:write).")
    if not user_token.startswith("xoxp-"):
        raise SlackAuthError("The user token must start with xoxp- (OAuth & Permissions → User OAuth Token).")
    where = secrets.set("slack_app_token", app_token)
    secrets.set("slack_user_token", user_token)
    return where
