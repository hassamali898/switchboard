"""Account safety: keeps every source far below its rate limits, and stops on trouble.

Accounts are sensitive, so the rules lean hard toward caution:
  - a floor between calls and hourly/daily caps per source
  - "slow down" answers (HTTP 429, quota) back off exponentially and honor Retry-After
  - three slow-downs in a row pause the source for 30 minutes (a circuit breaker)
  - a rejected sign-in stops the source until it is reconnected: retrying bad
    credentials in a loop is what makes providers lock accounts
  - other errors back off from 30 s up to 5 minutes

State lives in the SQLite queue, so a restart never resets a pause or a cap.
"""

from __future__ import annotations

import random
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Optional

from .queue import Queue

# Per source: minimum seconds between calls, calls per hour, calls per day.
LIMITS: dict[str, dict[str, float]] = {
    "slack": {"floor": 1.2, "hour": 600, "day": 6000},  # Tier 3 is ~50/min; we stay near 1/s at most
    "gmail": {"floor": 1.0, "hour": 600, "day": 8000},  # quota is ~250 units/s per user; we use a sliver
    "slack-connect": {"floor": 20.0, "hour": 30, "day": 300},  # apps.connections.open is Tier 1
}
DEFAULT_LIMITS = {"floor": 2.0, "hour": 300, "day": 3000}

STRIKES_TO_PAUSE = 3
PAUSE_SECONDS = 30 * 60
MAX_BACKOFF = 30 * 60
ERROR_BACKOFF = (30, 300)  # first, max


@dataclass
class SourceSafety:
    state: str = "ok"  # ok | backoff | paused | auth
    until: float = 0.0
    reason: str = ""
    strikes: int = 0
    errors: int = 0
    last_call: float = 0.0
    hour_start: float = 0.0
    hour_calls: int = 0
    day: str = ""
    day_calls: int = 0
    history: list[str] = field(default_factory=list)


class RateGuard:
    def __init__(self, queue: Queue, source: str, clock=time.time):
        self.queue = queue
        self.source = source
        self.clock = clock
        self.limits = LIMITS.get(source, DEFAULT_LIMITS)

    # ---- state -------------------------------------------------------------------

    def _key(self) -> str:
        return f"safety:{self.source}"

    def load(self) -> SourceSafety:
        raw = self.queue.get_kv(self._key()) or {}
        known = {k: v for k, v in raw.items() if k in SourceSafety.__dataclass_fields__}
        return SourceSafety(**known)

    def save(self, s: SourceSafety) -> None:
        s.history = s.history[-10:]
        self.queue.set_kv(self._key(), asdict(s))

    def status(self) -> dict[str, Any]:
        s = self.load()
        now = self.clock()
        if s.state in ("backoff", "paused") and now >= s.until:
            s.state, s.reason = "ok", ""
        return {"state": s.state, "until": s.until, "reason": s.reason}

    # ---- before a call -----------------------------------------------------------

    def wait_needed(self) -> tuple[float, str]:
        """Seconds to wait before the next call (0 = go now), and why. inf = stopped."""
        s = self.load()
        now = self.clock()
        if s.state == "auth":
            return float("inf"), s.reason or "Sign-in was rejected; reconnect this source."
        if s.state in ("backoff", "paused") and now < s.until:
            return s.until - now, s.reason
        if s.hour_start and now - s.hour_start < 3600 and s.hour_calls >= self.limits["hour"]:
            return s.hour_start + 3600 - now, "hourly safety cap reached"
        today = time.strftime("%Y-%m-%d", time.localtime(now))
        if s.day == today and s.day_calls >= self.limits["day"]:
            tomorrow = time.mktime(time.strptime(today, "%Y-%m-%d")) + 86400
            return tomorrow - now, "daily safety cap reached"
        gap = now - s.last_call
        if gap < self.limits["floor"]:
            return self.limits["floor"] - gap, ""
        return 0.0, ""

    def acquire(self, sleep=time.sleep, stop=None, max_wait: Optional[float] = None) -> bool:
        """Waits until a call is allowed, then records it.

        False when the source is stopped, `stop` is set, or the wait would exceed `max_wait`.
        """
        while True:
            wait, _ = self.wait_needed()
            if wait == float("inf") or (max_wait is not None and wait > max_wait):
                return False
            if wait <= 0:
                break
            if stop is not None:
                if stop.wait(min(wait, 60)):
                    return False
            else:
                sleep(min(wait, 60))
        self.record_call()
        return True

    def record_call(self) -> None:
        s = self.load()
        now = self.clock()
        if not s.hour_start or now - s.hour_start >= 3600:
            s.hour_start, s.hour_calls = now, 0
        today = time.strftime("%Y-%m-%d", time.localtime(now))
        if s.day != today:
            s.day, s.day_calls = today, 0
        s.hour_calls += 1
        s.day_calls += 1
        s.last_call = now
        self.save(s)

    # ---- after a call --------------------------------------------------------------

    def ok(self) -> None:
        """A call succeeded: strikes count only consecutive slow-downs."""
        s = self.load()
        if s.strikes or s.errors or s.state in ("backoff", "paused"):
            s.strikes, s.errors = 0, 0
            if s.state != "auth":
                s.state, s.reason, s.until = "ok", "", 0.0
            self.save(s)

    def limited(self, retry_after: Optional[float] = None) -> float:
        """The source said "slow down". Returns the pause in seconds."""
        s = self.load()
        s.strikes += 1
        now = self.clock()
        if s.strikes >= STRIKES_TO_PAUSE:
            pause = max(PAUSE_SECONDS, retry_after or 0)
            s.state, s.reason = "paused", "Paused to protect your account (the service asked us to slow down)"
        else:
            backoff = min(MAX_BACKOFF, 60 * (2 ** (s.strikes - 1)))
            pause = max(backoff, retry_after or 0) * random.uniform(1.0, 1.2)
            s.state, s.reason = "backoff", "Slowed down (the service asked us to wait)"
        s.until = now + pause
        s.history.append(f"{time.strftime('%H:%M')} rate-limited")
        self.save(s)
        return pause

    def failed(self) -> float:
        """A transient error (network, 5xx). Returns the wait in seconds."""
        s = self.load()
        s.errors += 1
        first, cap = ERROR_BACKOFF
        wait = min(cap, first * (2 ** (s.errors - 1))) * random.uniform(1.0, 1.2)
        s.state, s.until, s.reason = "backoff", self.clock() + wait, "Retrying after an error"
        self.save(s)
        return wait

    def auth_failed(self, reason: str) -> None:
        """Stop: never retry rejected credentials in a loop."""
        s = self.load()
        s.state, s.reason, s.until = "auth", reason, 0.0
        s.history.append(f"{time.strftime('%H:%M')} sign-in rejected")
        self.save(s)

    def resume(self) -> None:
        """The person pressed Resume, or reconnected the source."""
        s = self.load()
        s.state, s.reason, s.until, s.strikes, s.errors = "ok", "", 0.0, 0, 0
        self.save(s)


def classify(error: str) -> str:
    """'rate' | 'auth' | 'other' from an error's text (both APIs and connectors)."""
    text = error.lower()
    if any(k in text for k in ("429", "rate limit", "ratelimit", "rate_limit", "too many",
                               "quota", "resource_exhausted", "ratelimited", "userratelimitexceeded")):
        return "rate"
    if any(k in text for k in ("401", "invalid_auth", "invalid_grant", "token_revoked", "not_authed",
                               "account_inactive", "unauthenticated", "unauthorized", "reconnect")):
        return "auth"
    return "other"


def retry_after(exc: Exception) -> Optional[float]:
    response = getattr(exc, "response", None)
    headers = getattr(response, "headers", None) or {}
    value = headers.get("Retry-After") or headers.get("retry-after")
    try:
        return float(value) if value else None
    except (TypeError, ValueError):
        return None
