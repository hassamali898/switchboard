#!/bin/sh
# Switchboard installer: one command, then everything else happens inside Claude Code.
#
#   ./install.sh              install (safe to run again)
#   ./install.sh --uninstall  remove it from Claude Code (your tokens stay in the keychain)
#
# What it does:
#   1. builds the plugin's Python environment (.venv), so the first session starts at once
#   2. adds three keys to the "env" block of ~/.claude/settings.json (a backup is kept):
#        CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1   function hooks are early access in Claude Code
#        CLAUDE_CODE_PLUGIN_DIRS=<this folder> loads the plugin in every session, desktop included
#        CLAUDE_CODE_PLUGIN_DIR_WATCH=1        desktop sessions reload the plugin when its files change
set -eu
ROOT=$(cd "$(dirname "$0")" && pwd)
SETTINGS="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"
STATE_DIR="${SWITCHBOARD_HOME:-$HOME/.switchboard}"
MODE="${1:-install}"

say() { printf '%s\n' "$*"; }

find_python() {
  for candidate in python3 /usr/bin/python3 /opt/homebrew/bin/python3 /usr/local/bin/python3; do
    command -v "$candidate" >/dev/null 2>&1 && { command -v "$candidate"; return 0; }
  done
  return 1
}

# Edits settings.json with Python's json module (present on macOS and Linux).
edit_settings() {
  PY=$(find_python) || { say "✗ python3 is needed to edit $SETTINGS"; exit 1; }
  ACTION="$1" ROOT="$ROOT" SETTINGS="$SETTINGS" STATE_DIR="$STATE_DIR" "$PY" - <<'PYEOF'
import json, os, shutil, sys, time

action, root, path, state_dir = (os.environ[k] for k in ("ACTION", "ROOT", "SETTINGS", "STATE_DIR"))
marker = os.path.join(state_dir, "installed.json")
try:
    with open(path) as f:
        settings = json.load(f)
except FileNotFoundError:
    settings = {}
except ValueError as exc:
    sys.exit(f"✗ {path} is not valid JSON ({exc}); fix it and run the installer again.")
if not isinstance(settings, dict):
    sys.exit(f"✗ {path} does not hold a JSON object.")
env = settings.get("env") if isinstance(settings.get("env"), dict) else {}
dirs = [d for d in str(env.get("CLAUDE_CODE_PLUGIN_DIRS", "")).split(os.pathsep) if d]

if action == "install":
    added_flag = env.get("CLAUDE_CODE_ENABLE_FUNCTION_HOOKS") != "1"
    added_watch = env.get("CLAUDE_CODE_PLUGIN_DIR_WATCH") != "1"
    env["CLAUDE_CODE_PLUGIN_DIR_WATCH"] = "1"
    if root not in dirs:
        dirs.append(root)
    env["CLAUDE_CODE_PLUGIN_DIRS"] = os.pathsep.join(dirs)
    env["CLAUDE_CODE_ENABLE_FUNCTION_HOOKS"] = "1"
    os.makedirs(state_dir, exist_ok=True)
    previous = {}
    if os.path.exists(marker):
        with open(marker) as f:
            previous = json.load(f)
    with open(marker, "w") as f:
        json.dump({"root": root, "added_flag": previous.get("added_flag", added_flag),
                   "added_watch": previous.get("added_watch", added_watch)}, f)
else:
    try:
        with open(marker) as f:
            recorded = json.load(f)
        added_flag = recorded.get("added_flag", False)
        added_watch = recorded.get("added_watch", False)
    except (OSError, ValueError):
        added_flag = added_watch = False
    dirs = [d for d in dirs if d != root]
    if dirs:
        env["CLAUDE_CODE_PLUGIN_DIRS"] = os.pathsep.join(dirs)
    else:
        env.pop("CLAUDE_CODE_PLUGIN_DIRS", None)
    if added_flag:  # only remove the flag if this installer turned it on
        env.pop("CLAUDE_CODE_ENABLE_FUNCTION_HOOKS", None)
    if added_watch:
        env.pop("CLAUDE_CODE_PLUGIN_DIR_WATCH", None)
    if os.path.exists(marker):
        os.remove(marker)

if env:
    settings["env"] = env
else:
    settings.pop("env", None)
os.makedirs(os.path.dirname(path), exist_ok=True)
if os.path.exists(path):
    shutil.copyfile(path, f"{path}.switchboard-backup-{time.strftime('%Y%m%d-%H%M%S')}")
tmp = path + ".switchboard-tmp"
with open(tmp, "w") as f:
    json.dump(settings, f, indent=2)
    f.write("\n")
os.replace(tmp, path)
PYEOF
}

if [ "$MODE" = "--uninstall" ] || [ "$MODE" = "uninstall" ]; then
  edit_settings uninstall
  say "✓ Switchboard removed from Claude Code (start a new session to unload it)."
  say "  Your tokens are still in the keychain. To remove them too:"
  say "    $ROOT/.venv/bin/python -m watcher.auth logout slack"
  say "    $ROOT/.venv/bin/python -m watcher.auth logout google"
  exit 0
fi

say "Installing Switchboard from $ROOT"
command -v claude >/dev/null 2>&1 || say "! The claude CLI is not on PATH. That is fine for the desktop app; the terminal needs Claude Code installed."

if sh "$ROOT/scripts/bootstrap.sh" >/dev/null; then
  say "✓ Python environment ready"
else
  say "! Could not build the Python environment now. The plugin retries on first run and shows what is missing."
fi

edit_settings install
say "✓ Added to Claude Code ($SETTINGS; a backup sits next to it)"
say ""
say "Done. Start a new Claude Code session (desktop Code tab or terminal) and type /sb-inbox here to make it the Inbox session."
say "Connect your sources from the Inbox pane, or run /sb-inbox demo on to try it with demo messages first."
