#!/bin/sh
# Checks the plugin against every Claude Code on this machine: the terminal's and the one the desktop
# app runs (its newest bundle, which can be a release behind). Type-checks, validates, runs the tests,
# and says whether function hooks are switched on. It never changes your settings.
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
MIN=2.1.295
status=0

# Is version $1 at least $2?
at_least() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -t. -k1,1n -k2,2n -k3,3n | head -1)" = "$2" ]; }

echo "== types"
if [ -x "$ROOT/node_modules/.bin/tsc" ]; then
  "$ROOT/node_modules/.bin/tsc" -p "$ROOT" && echo "   tsc clean" || status=1
else
  echo "   skipped: run npm install for tsc"
fi

BUNDLED="$HOME/Library/Application Support/Claude/claude-code"
DESKTOP=""
if [ -d "$BUNDLED" ]; then
  latest=$(ls "$BUNDLED" | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)
  # Newer bundles add a build-hash folder: <version>/<hash>/claude.app.
  app=$(ls -d "$BUNDLED/$latest/claude.app" "$BUNDLED/$latest"/*/claude.app 2>/dev/null | tail -1)
  [ -n "$app" ] && DESKTOP="$app/Contents/MacOS/claude"
fi

for claude in "$(command -v claude 2>/dev/null)" "$DESKTOP"; do
  [ -n "$claude" ] && [ -x "$claude" ] || continue
  version=$("$claude" --version 2>/dev/null | awk '{print $1}')
  echo "== $version ($claude)"
  if ! at_least "$version" "$MIN"; then
    echo "   below the minimum $MIN: Switchboard won't load here"; status=1; continue
  fi
  "$claude" plugin validate "$ROOT" 2>&1 | grep -E "^✘|^✔|❯ .*(error|refused|reaches outside|not a function)" || status=1
  out=$(CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 "$claude" plugin test "$ROOT" 2>&1)
  if printf '%s\n' "$out" | grep -q "^ 0 fail"; then
    echo "   tests pass"
  else
    echo "   tests FAIL"; status=1
    printf '%s\n' "$out" | grep -E "^\(fail\)|error:" | head -20 | sed 's/^/     /'
  fi
done

echo "== setup"
if grep -q '"CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": *"1"' "$HOME/.claude/settings.json" 2>/dev/null \
   || [ "${CLAUDE_CODE_ENABLE_FUNCTION_HOOKS:-}" = "1" ]; then
  echo "   function hooks are on"
else
  echo "   function hooks are OFF: add \"CLAUDE_CODE_ENABLE_FUNCTION_HOOKS\": \"1\" under \"env\" in ~/.claude/settings.json"
fi
exit $status
