"""Reads a token from the clipboard so it is never typed, drawn or logged, then clears it."""

from __future__ import annotations

import shutil
import subprocess
from typing import Optional

READERS = (
    ["pbpaste"],
    ["wl-paste", "--no-newline"],
    ["xclip", "-selection", "clipboard", "-o"],
    ["xsel", "--clipboard", "--output"],
    ["powershell", "-NoProfile", "-Command", "Get-Clipboard"],
)
WRITERS = (
    ["pbcopy"],
    ["wl-copy"],
    ["xclip", "-selection", "clipboard"],
    ["xsel", "--clipboard", "--input"],
    ["powershell", "-NoProfile", "-Command", "Set-Clipboard -Value $null"],
)


class ClipboardUnavailable(RuntimeError):
    pass


def _first(commands) -> Optional[list[str]]:
    return next((cmd for cmd in commands if shutil.which(cmd[0])), None)


def read() -> str:
    cmd = _first(READERS)
    if cmd is None:
        raise ClipboardUnavailable("No clipboard tool found (pbpaste, wl-paste, xclip, xsel). "
                                   "Run python -m watcher.auth slack in a terminal instead.")
    return subprocess.run(cmd, capture_output=True, text=True, timeout=5).stdout.strip()


def clear_if(value: str) -> None:
    """Empties the clipboard, but only while it still holds `value` (the token we took)."""
    try:
        if read() != value:
            return
        cmd = _first(WRITERS)
        if cmd:
            subprocess.run(cmd, input="", text=True, timeout=5)
    except Exception:
        pass
