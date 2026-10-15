"""Alert levels from priorities.yaml: first matching rule wins; focus and quiet hours
lower everything except Critical to Quiet. No AI involved.
(Auto rules are matched by the plugin, in the Inbox session.)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, time as dtime
from pathlib import Path
from typing import Any, Iterable, Optional

import yaml

from . import paths
from .items import LEVELS, Item


def _as_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return [str(v) for v in value]
    return [str(value)]


def _parse_hhmm(text: str) -> dtime:
    hour, minute = str(text).split(":")
    return dtime(int(hour), int(minute))


@dataclass
class Priorities:
    rules: list[dict[str, Any]] = field(default_factory=list)
    default_level: str = "normal"
    focus: bool = False
    quiet_hours: Optional[tuple[dtime, dtime]] = None
    excluded: dict[str, list[str]] = field(default_factory=dict)
    muted: dict[str, list[str]] = field(default_factory=dict)
    slack_watch: list[str] = field(default_factory=lambda: ["dms", "mentions", "threads"])

    @classmethod
    def load(cls, path: Optional[Path] = None) -> "Priorities":
        path = path or paths.user_config("priorities.yaml")
        data = yaml.safe_load(Path(path).read_text()) or {}
        return cls.from_dict(data)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Priorities":
        quiet = data.get("quiet_hours") or {}
        quiet_hours = None
        if quiet.get("enabled"):
            quiet_hours = (_parse_hhmm(quiet.get("start", "20:00")), _parse_hhmm(quiet.get("end", "09:00")))
        default = data.get("default_level", "normal")
        if default not in LEVELS:
            raise ValueError(f"default_level must be one of {LEVELS}, got {default!r}")
        rules = list(data.get("rules") or [])
        for rule in rules:
            if rule.get("level") not in LEVELS:
                raise ValueError(f"rule {rule.get('name')!r}: level must be one of {LEVELS}")
        excluded = {k: _as_list(v) for k, v in (data.get("excluded") or {}).items()}
        muted = {k: _as_list(v) for k, v in (data.get("muted") or {}).items()}
        slack = data.get("slack") or {}
        return cls(
            rules=rules,
            default_level=default,
            focus=bool(data.get("focus", False)),
            quiet_hours=quiet_hours,
            excluded=excluded,
            muted=muted,
            slack_watch=_as_list(slack.get("watch")) or ["dms", "mentions", "threads"],
        )

    # ---- matching -----------------------------------------------------------

    def rule_matches(self, rule: dict[str, Any], item: Item) -> bool:
        meta = item.meta
        checks: list[bool] = []
        if "source" in rule:
            checks.append(item.source in _as_list(rule["source"]))
        if "kind" in rule:
            checks.append(item.kind in _as_list(rule["kind"]))
        if "from" in rule:
            checks.append(_sender_in(item, _as_list(rule["from"])))
        if "domain" in rule:
            domain = item.sender.email.rsplit("@", 1)[-1].lower() if "@" in item.sender.email else ""
            checks.append(domain in [d.lower() for d in _as_list(rule["domain"])])
        if "channel" in rule:
            checks.append(str(meta.get("channel_name", "")).lstrip("#") in
                          [c.lstrip("#") for c in _as_list(rule["channel"])])
        if "label" in rule:
            labels = set(meta.get("labels") or [])
            checks.append(bool(labels & set(_as_list(rule["label"]))))
        if "keywords" in rule:
            haystack = f"{item.title}\n{item.body}".lower()
            checks.append(any(k.lower() in haystack for k in _as_list(rule["keywords"])))
        return bool(checks) and all(checks)

    def base_level(self, item: Item) -> str:
        for rule in self.rules:
            if self.rule_matches(rule, item):
                return rule["level"]
        return self.default_level

    def in_quiet_hours(self, now: datetime) -> bool:
        if not self.quiet_hours:
            return False
        start, end = self.quiet_hours
        current = now.time()
        if start <= end:
            return start <= current < end
        return current >= start or current < end  # spans midnight

    def level_for(self, item: Item, now: Optional[datetime] = None) -> str:
        level = self.base_level(item)
        if level != "critical" and (self.focus or self.in_quiet_hours(now or datetime.now())):
            return "quiet"
        return level

    def is_excluded(self, item: Item) -> bool:
        """Sensitive items: listed, but never sent to Claude."""
        labels = set(item.meta.get("labels") or [])
        if labels & set(self.excluded.get("gmail_labels", [])):
            return True
        channel = str(item.meta.get("channel_name", "")).lstrip("#")
        if channel and channel in self.excluded.get("slack_channels", []):
            return True
        haystack = f"{item.title}\n{item.body}".lower()
        return any(k.lower() in haystack for k in self.excluded.get("keywords", []))

    def is_muted(self, item: Item) -> bool:
        if _sender_in(item, self.muted.get("senders", [])):
            return True
        channel = str(item.meta.get("channel_name", "")).lstrip("#")
        return bool(channel) and channel in self.muted.get("slack_channels", [])

    def apply(self, item: Item, now: Optional[datetime] = None) -> Optional[Item]:
        """Set level and excluded flag; None when the item is muted (drop it)."""
        if self.is_muted(item):
            return None
        item.level = self.level_for(item, now)  # type: ignore[assignment]
        item.excluded = self.is_excluded(item)
        return item


def _sender_in(item: Item, people: Iterable[str]) -> bool:
    wanted = {p.lower() for p in people}
    return bool(wanted & {item.sender.name.lower(), item.sender.handle.lower(), item.sender.email.lower()} - {""})
