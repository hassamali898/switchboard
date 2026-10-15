"""Token storage: the OS keychain first, a git-ignored .env file only as a fallback.

Never log or print the values this module returns.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from .. import paths

SERVICE = "switchboard"

# keychain name -> .env variable
ENV_NAMES = {
    "slack_app_token": "SLACK_APP_TOKEN",
    "slack_user_token": "SLACK_USER_TOKEN",
    "google_token": "GOOGLE_TOKEN_JSON",
}


def _keyring():
    try:
        import keyring
        from keyring.backends.fail import Keyring as FailKeyring

        if isinstance(keyring.get_keyring(), FailKeyring):
            return None
        return keyring
    except Exception:
        return None


def _dotenv() -> dict[str, str]:
    values: dict[str, str] = {}
    for candidate in (paths.REPO_ROOT / ".env", paths.home() / ".env"):
        if not candidate.exists():
            continue
        for line in candidate.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    return values


def get(name: str) -> Optional[str]:
    ring = _keyring()
    if ring is not None:
        try:
            value = ring.get_password(SERVICE, name)
            if value:
                return value
        except Exception:
            pass
    env_name = ENV_NAMES.get(name, name.upper())
    return os.environ.get(env_name) or _dotenv().get(env_name) or None


def set(name: str, value: str) -> str:
    """Store a secret. Returns where it went: 'keychain' or the .env path."""
    ring = _keyring()
    if ring is not None:
        ring.set_password(SERVICE, name, value)
        return "keychain"
    env_file = paths.home() / ".env"
    lines = env_file.read_text().splitlines() if env_file.exists() else []
    env_name = ENV_NAMES.get(name, name.upper())
    lines = [l for l in lines if not l.startswith(f"{env_name}=")] + [f"{env_name}={value}"]
    env_file.write_text("\n".join(lines) + "\n")
    env_file.chmod(0o600)
    return str(env_file)


def delete(name: str) -> None:
    ring = _keyring()
    if ring is not None:
        try:
            ring.delete_password(SERVICE, name)
        except Exception:
            pass


def _config_file() -> Path:
    return paths.home() / "config.json"


def config_value(name: str) -> Optional[str]:
    """Non-secret settings (topic names, client-secrets path): env, .env, then config.json."""
    import json

    found = os.environ.get(name) or _dotenv().get(name)
    if found:
        return found
    try:
        return json.loads(_config_file().read_text()).get(name) or None
    except (OSError, ValueError):
        return None


def set_config(**values: str) -> None:
    """Saves non-secret settings the in-app setup discovered (never tokens)."""
    import json

    path = _config_file()
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        data = {}
    data.update(values)
    path.write_text(json.dumps(data, indent=2) + "\n")
    path.chmod(0o600)


def redact(text: str) -> str:
    """Strip anything that looks like a token before text reaches a log or the UI."""
    import re

    return re.sub(r"(xox[a-z]-|xapp-|ya29\.|1//|GOCSPX-|gh[pousr]_|github_pat_)[A-Za-z0-9._-]+", r"\1***", text)


def exists(path: Optional[str]) -> bool:
    return bool(path) and Path(str(path)).expanduser().exists()
