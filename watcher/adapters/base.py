"""The callbacks a direct source adapter (Slack, Gmail) reports through; each one's `run` blocks until stopped."""

from __future__ import annotations

from typing import Callable

from ..items import Item

Emit = Callable[[Item], None]
# status(source, state, message): state is live | polling | reconnecting | error
Status = Callable[[str, str, str], None]


