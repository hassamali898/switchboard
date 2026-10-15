#!/bin/sh
# Builds (or repairs) Switchboard's Python environment in .venv. Safe to run any time:
# it does nothing when .venv matches pyproject.toml, and a lock keeps two runs (two
# windows starting together) from racing.
#
#   scripts/bootstrap.sh           build if needed
#   scripts/bootstrap.sh --check   exit 0 if ready, 1 if a build is needed, 2 if no Python 3.10+
#
# Progress goes to stderr; the last stdout line is the Python it settled on.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
VENV="$ROOT/.venv"
STAMP="$VENV/.switchboard-stamp"
LOCK="$ROOT/.bootstrap.lock"

want_stamp() {
  # The environment matches when pyproject.toml has not changed since it was built.
  cksum < "$ROOT/pyproject.toml" | awk '{print $1 "-" $2}'
}

find_python() {
  for candidate in "${SWITCHBOARD_PYTHON:-}" python3.14 python3.13 python3.12 python3.11 python3.10 \
      /opt/homebrew/bin/python3 /usr/local/bin/python3 python3; do
    [ -n "$candidate" ] || continue
    command -v "$candidate" >/dev/null 2>&1 || continue
    if "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
      command -v "$candidate"
      return 0
    fi
  done
  return 1
}

ready() {
  [ -x "$VENV/bin/python" ] && [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$(want_stamp)" ]
}

if [ "${1:-}" = "--check" ]; then
  if ready; then echo "$VENV/bin/python"; exit 0; fi
  find_python >/dev/null || exit 2
  exit 1
fi

if ready; then echo "$VENV/bin/python"; exit 0; fi

# One builder at a time; the others wait for it (up to 10 minutes).
waited=0
while ! mkdir "$LOCK" 2>/dev/null; do
  if [ "$waited" -ge 600 ]; then echo "Another setup is still running (remove $LOCK if it is stale)." >&2; exit 1; fi
  sleep 2; waited=$((waited + 2))
  if ready; then echo "$VENV/bin/python"; exit 0; fi
done
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT INT TERM

PY=$(find_python) || {
  echo "Switchboard needs Python 3.10 or newer. Install it (macOS: brew install python) and start a new session." >&2
  exit 2
}
echo "Setting up Switchboard with $PY …" >&2
[ -x "$VENV/bin/python" ] || "$PY" -m venv "$VENV" >&2
"$VENV/bin/python" -m pip install --quiet --disable-pip-version-check --upgrade pip >&2
"$VENV/bin/python" -m pip install --quiet --disable-pip-version-check -e "$ROOT" >&2
want_stamp > "$STAMP"
echo "Switchboard is ready." >&2
echo "$VENV/bin/python"
