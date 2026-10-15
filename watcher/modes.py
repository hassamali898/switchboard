"""How each source connects: `direct` (our own tokens) or `connector` (Claude's connector).

Chosen in the pane's Settings and saved in ~/.switchboard/config.json (not a secret).
"""

from __future__ import annotations

from .auth import secrets

MODES = {"gmail": ("connector", "direct"), "slack": ("direct",)}
KEYS = {"gmail": "GMAIL_MODE", "slack": "SLACK_MODE"}


def mode(source: str) -> str:
    """The chosen method, or '' when the person hasn't chosen yet."""
    value = secrets.config_value(KEYS[source]) or ""
    if value in MODES[source]:
        return value
    if source == "gmail" and secrets.get("google_token"):
        return "direct"  # connected before methods existed
    if source == "slack":
        return "direct"  # the only method for Slack today
    return ""


def set_mode(source: str, value: str) -> None:
    if source not in MODES or value not in MODES[source]:
        raise ValueError(f"{source} can't use {value!r}; choose one of {MODES.get(source)}")
    secrets.set_config(**{KEYS[source]: value})


def gmail_me() -> str:
    return secrets.config_value("GMAIL_ME") or ""
