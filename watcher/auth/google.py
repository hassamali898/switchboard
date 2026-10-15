"""Google OAuth (Desktop client, user type Internal) and Gmail push setup.

Gmail scopes now; Calendar arrives in phase 2. `connect()` is the in-app path: it finds
the OAuth client JSON, runs the browser sign-in and sets up Pub/Sub push on its own.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any, Optional

from .. import paths
from . import secrets

GMAIL_SCOPES = [
    "https://www.googleapis.com/auth/gmail.modify",  # read, label, drafts
    "https://www.googleapis.com/auth/gmail.send",
]
PUBSUB_SCOPES = ["https://www.googleapis.com/auth/pubsub"]
SCOPES = GMAIL_SCOPES + PUBSUB_SCOPES

TOPIC_ID = "switchboard-gmail"
SUBSCRIPTION_ID = "switchboard-gmail-pull"
GMAIL_PUSH_ACCOUNT = "serviceAccount:gmail-api-push@system.gserviceaccount.com"
SIGN_IN_TIMEOUT_S = 300


class GoogleAuthError(RuntimeError):
    """Raised with a user-facing fix ("Reconnect Gmail: ...")."""


class NotConnected(GoogleAuthError):
    """No sign-in yet: the pane shows the Connect Gmail steps instead of an error."""


def stored_client_path() -> Path:
    return paths.home() / "google_client.json"


def find_client_secrets(explicit: Optional[str] = None) -> Optional[Path]:
    """The OAuth client JSON: given, configured, already stored, or the newest download."""
    for candidate in (explicit, secrets.config_value("GOOGLE_CLIENT_SECRETS")):
        if secrets.exists(candidate):
            return Path(str(candidate)).expanduser()
    if stored_client_path().exists():
        return stored_client_path()
    downloads = Path.home() / "Downloads"
    found = sorted(downloads.glob("client_secret*.json"), key=lambda p: p.stat().st_mtime, reverse=True) \
        if downloads.is_dir() else []
    for path in found:
        if _client_info(path):
            return path
    return None


def _client_info(path: Path) -> Optional[dict[str, Any]]:
    """The `installed` block of a Desktop OAuth client JSON, or None for anything else."""
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        return None
    info = data.get("installed")
    return info if isinstance(info, dict) and info.get("client_id") else None


def adopt_client(path: Path) -> Path:
    """Copies the client JSON into ~/.switchboard (private) so Downloads can be cleaned."""
    target = stored_client_path()
    if path.resolve() != target.resolve():
        shutil.copyfile(path, target)
    target.chmod(0o600)
    return target


def sign_in(client_secrets: Optional[str] = None) -> str:
    """Runs the browser sign-in and stores the refresh token in the keychain."""
    from google_auth_oauthlib.flow import InstalledAppFlow

    path = find_client_secrets(client_secrets)
    if path is None:
        raise GoogleAuthError(
            "No Google OAuth client found. In Google Cloud Console create an OAuth client "
            "(type Desktop app) and download its JSON; it is picked up from Downloads."
        )
    if _client_info(path) is None:
        raise GoogleAuthError(f"{path.name} is not a Desktop-app OAuth client. Create one of type Desktop app.")
    stored = adopt_client(path)
    flow = InstalledAppFlow.from_client_secrets_file(str(stored), SCOPES)
    try:
        creds = flow.run_local_server(port=0, open_browser=True, prompt="consent",
                                      timeout_seconds=SIGN_IN_TIMEOUT_S)
    except Exception as exc:
        raise GoogleAuthError("Google sign-in did not finish (closed or timed out). Press Connect Gmail again.") from exc
    if creds is None:
        raise GoogleAuthError("Google sign-in timed out. Press Connect Gmail again.")
    return secrets.set("google_token", creds.to_json())


def credentials():
    """Loads stored credentials, refreshing them when expired."""
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials

    raw = secrets.get("google_token")
    if not raw:
        raise NotConnected("Gmail is not connected yet. Connect it in Switchboard's Settings (/sb-inbox).")
    creds = Credentials.from_authorized_user_info(json.loads(raw), SCOPES)
    if not creds.valid:
        if creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
            except Exception as exc:  # RefreshError and transport errors
                raise GoogleAuthError(
                    "Reconnect Gmail: the Google sign-in expired or was revoked. Reconnect it in Switchboard's Settings."
                ) from exc
            secrets.set("google_token", creds.to_json())
        else:
            raise GoogleAuthError("Reconnect Gmail in Switchboard's Settings.")
    return creds


def project_id() -> Optional[str]:
    path = find_client_secrets()
    info = _client_info(path) if path else None
    return info.get("project_id") if info else None


def setup_pubsub(creds, project: str, service=None) -> dict[str, str]:
    """Creates the topic, lets Gmail publish to it, and creates a pull subscription.

    Idempotent: existing pieces are kept. Returns the names to save.
    """
    from googleapiclient.errors import HttpError

    if service is None:
        from googleapiclient.discovery import build

        service = build("pubsub", "v1", credentials=creds, cache_discovery=False)
    topic = f"projects/{project}/topics/{TOPIC_ID}"
    subscription = f"projects/{project}/subscriptions/{SUBSCRIPTION_ID}"
    topics = service.projects().topics()
    try:
        topics.create(name=topic, body={}).execute()
    except HttpError as exc:
        if exc.resp.status != 409:  # 409: already exists
            raise
    policy = topics.getIamPolicy(resource=topic).execute()
    bindings = policy.setdefault("bindings", [])
    publisher = next((b for b in bindings if b.get("role") == "roles/pubsub.publisher"), None)
    if publisher is None:
        bindings.append({"role": "roles/pubsub.publisher", "members": [GMAIL_PUSH_ACCOUNT]})
    elif GMAIL_PUSH_ACCOUNT not in publisher.setdefault("members", []):
        publisher["members"].append(GMAIL_PUSH_ACCOUNT)
    topics.setIamPolicy(resource=topic, body={"policy": policy}).execute()
    try:
        service.projects().subscriptions().create(name=subscription, body={
            "topic": topic, "ackDeadlineSeconds": 30, "messageRetentionDuration": "86400s",
        }).execute()
    except HttpError as exc:
        if exc.resp.status != 409:
            raise
    return {"GMAIL_PUBSUB_TOPIC": topic, "GMAIL_PUBSUB_SUBSCRIPTION": subscription}


def connect(client_secrets: Optional[str] = None) -> dict[str, Any]:
    """The whole in-app Gmail setup: sign in, then push if the project allows it."""
    sign_in(client_secrets)
    creds = credentials()
    project = project_id()
    if not project:
        return {"ok": True, "push": False, "message": "Gmail connected. Checking every 60 s (no project id for push)."}
    try:
        names = setup_pubsub(creds, project)
    except Exception as exc:
        text = str(exc)
        if "has not been used" in text or "is disabled" in text or "SERVICE_DISABLED" in text:
            hint = (f"Enable the Pub/Sub API for real-time mail: https://console.cloud.google.com/apis/library/"
                    f"pubsub.googleapis.com?project={project}, then press Connect Gmail again.")
        elif "403" in text or "PERMISSION_DENIED" in text:
            hint = "Your account can't create Pub/Sub topics in this project; real-time mail needs that role."
        else:
            hint = "Pub/Sub setup failed; real-time mail is off."
        return {"ok": True, "push": False, "message": f"Gmail connected. Checking every 60 s. {hint}"}
    secrets.set_config(**names)
    return {"ok": True, "push": True, "message": "Gmail connected with real-time push."}


def connected() -> dict[str, bool]:
    return {
        "signed_in": bool(secrets.get("google_token")),
        "client": find_client_secrets() is not None,
        "push": bool(secrets.config_value("GMAIL_PUBSUB_SUBSCRIPTION")),
    }
