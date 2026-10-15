"""Where Switchboard keeps its local data. Everything stays on this machine."""

from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def home() -> Path:
    """The data folder (queue, lock file, user config), readable only by this user."""
    configured = os.environ.get("SWITCHBOARD_HOME", "").strip()
    path = Path(configured).expanduser() if configured else Path.home() / ".switchboard"
    path.mkdir(parents=True, exist_ok=True)
    try:
        path.chmod(0o700)
    except OSError:
        pass
    return path


def is_demo() -> bool:
    """Demo mode keeps its own queue, so demo items never mix with real ones."""
    return os.environ.get("SWITCHBOARD_DEMO", "") == "1"


def db_path() -> Path:
    return home() / ("demo.db" if is_demo() else "queue.db")


def lock_path() -> Path:
    return home() / ("demo-watcher.lock" if is_demo() else "watcher.lock")


def user_config(name: str) -> Path:
    """`~/.switchboard/<name>` if the user made one, else the shipped example."""
    own = home() / name
    if own.exists():
        return own
    return REPO_ROOT / "config" / name.replace(".yaml", ".example.yaml")
