import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(autouse=True)
def isolated_home(tmp_path, monkeypatch):
    """Never touch the real ~/.switchboard or the keychain from tests."""
    monkeypatch.setenv("SWITCHBOARD_HOME", str(tmp_path / "home"))
    monkeypatch.delenv("SWITCHBOARD_DEMO", raising=False)
    import keyring
    from keyring.backends.fail import Keyring as FailKeyring

    monkeypatch.setattr(keyring, "get_keyring", lambda: FailKeyring())
    yield


@pytest.fixture
def slack_events():
    return json.loads((FIXTURES / "slack_events.json").read_text())


@pytest.fixture
def gmail_messages():
    return json.loads((FIXTURES / "gmail_messages.json").read_text())


@pytest.fixture
def queue(tmp_path):
    from watcher.queue import Queue

    q = Queue(tmp_path / "queue.db")
    yield q
    q.close()
