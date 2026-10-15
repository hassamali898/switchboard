"""JSON commands for the plugin UI: `python -m watcher.cli <command>` with a JSON request on stdin.

Every write goes through watcher.actions, the one guarded send path.

    list      {"unread_only": false, "source": null}  -> {"items": [...]}   (for you: what the queue holds)
    thread    {"ref": 12}                              -> {"item", "messages", "older"} or {"excluded": true}
    target    {"ref": 12, "reply_all": false}          -> {"target": "Slack · DM with …"}
    send      {"ref": 12, "text": "…", "idempotency_key": "…", "confirm_target": "…",
               "reply_all": false, "ack_changes": false} -> {"ok": true, "action_id", "undo"}
    draft     {"ref": 12, "text": "…"}                 -> {"ok": true, "where": "…"}
    get_draft {"ref": 12}                              -> {"text": "…" | null}
    read      {"refs": [12, 13]} or {"all": true}      -> {"marked": 2}
    undo      {"action_id": 7}                         -> {"ok": true}

Auto rules (send also takes "rule" and "cap": the rule's daily limit, checked before anything goes):
    archive   {"ref": 12, "rule": "Not important", "cap": 5} -> {"ok": true, "action_id", "undo"}
    cap       {"rule": "Replies", "cap": 5}            -> {"used": 3, "allowed": true}
    log       {"ref": 12, "action": "review", "rule": "Ahmed Raza", "text": "…"} -> {"ok": true, "action_id"}

The Inbox session as orchestrator (other windows make no model calls):
    drafts_get    {"ref": 12}                          -> {"drafts": {short, detailed, ask, ask_label} | null}
    drafts_put    {"ref": 12, "drafts": {...}}         -> {"ok": true}
    request       {"ref": 12, "kind": "draft"|"improve", "text", "instruction", "owner"} -> {"id": "…"}
    requests_take {}                                   -> {"requests": [...]}   (the Inbox session only)
    request_done  {"id": "…", "result": "…", "error": ""} -> {"ok": true}
    request_get   {"id": "…"}                          -> {"request": {...}}
    lease_get     {"name": "connectors-home"}          -> {"lease": {"owner", "until"} | null}
    actions   {"limit": 20}                            -> {"actions": [...]}   (for you: what was sent, by which rule)

Gmail through Claude's connector (the plugin makes the connector calls):
    ingest      {"source": "gmail", "threads": [...]}  -> {"items": [...], "me": "…"}
    lease       {"name": "poll:gmail", "owner": "…", "ttl": 90, "force": false} -> {"granted": true}
    send_plan   {"ref", "text", "idempotency_key", "confirm_target", "reply_all", "rule"?, "cap"?} -> {"plan": {...}}
    send_done   {"ref", "idempotency_key", "result", "reply_all"} -> {"ok": true, "action_id"}
    send_failed {"idempotency_key", "code", "error"}   -> {"ok": true}

Settings:
    safety      {}                                     -> {"sources": {"slack": {...}, "gmail": {...}}}
    resume      {"source": "gmail"}                    -> {"ok": true}
    modes       {}                                     -> {"gmail": "connector", "slack": "direct"}
    set_mode    {"source": "gmail", "mode": "connector"} -> {"ok": true}

Errors print {"ok": false, "code": "…", "error": "…"} and exit 1.
"""

from __future__ import annotations

import json
import sys
from typing import Any

from . import actions, modes
from .auth.secrets import redact
from .queue import Queue
from .safety import RateGuard


def run(command: str, request: dict[str, Any], queue: Queue, clients: actions.Clients) -> dict[str, Any]:
    if command == "list":
        items = queue.list(unread_only=bool(request.get("unread_only")), source=request.get("source"))
        return {"items": [i.to_json() for i in items]}
    if command == "thread":
        return actions.get_thread(queue, request["ref"], clients)
    if command == "target":
        item = actions.require_item(queue, request["ref"])
        me = actions.me_for(item, clients)
        return {"target": actions.describe_target(item, bool(request.get("reply_all")), me)}
    if command == "send":
        return actions.send_reply(
            queue, request["ref"], request["text"], clients=clients,
            idempotency_key=request.get("idempotency_key"),
            confirm_target=request.get("confirm_target"),
            reply_all=bool(request.get("reply_all")),
            ack_changes=bool(request.get("ack_changes")),
            rule=str(request.get("rule") or ""),
            cap=int(request["cap"]) if request.get("cap") is not None else None,
        )
    if command == "archive":
        return actions.archive(queue, request["ref"], str(request.get("rule") or ""),
                               int(request["cap"]) if request.get("cap") is not None else None)
    if command == "drafts_get":
        return {"drafts": queue.get_drafts(actions.require_item(queue, request["ref"]).id)}
    if command == "drafts_put":
        item = actions.require_item(queue, request["ref"])
        drafts = request.get("drafts") or {}
        queue.put_drafts(item.id, {key: str(drafts.get(key) or "")[:20000] for key in ("short", "detailed", "ask", "ask_label")})
        return {"ok": True}
    if command == "request":
        item = actions.require_item(queue, request["ref"])
        kind = str(request.get("kind") or "")
        if kind not in ("draft", "improve"):
            raise actions.SendBlocked("unsupported", f"Unknown request {kind!r}.")
        return {"ok": True, "id": queue.add_request(item.id, kind, str(request.get("text") or ""),
                                                    str(request.get("instruction") or ""), str(request.get("owner") or ""))}
    if command == "requests_take":
        # Taking is also the Inbox session's heartbeat: other windows ask it only while it is alive.
        if request.get("owner"):
            queue.lease("inbox-alive", str(request["owner"]), 15)
        return {"requests": queue.take_requests(int(request.get("limit", 5)))}
    if command == "request_done":
        queue.finish_request(str(request["id"]), str(request.get("result") or ""), str(request.get("error") or ""))
        return {"ok": True}
    if command == "request_get":
        return {"request": queue.get_request(str(request["id"]))}
    if command == "lease_get":
        return {"lease": queue.get_kv(f"lease:{request['name']}")}
    if command == "cap":
        rule = str(request["rule"])
        cap = int(request["cap"]) if request.get("cap") is not None else None
        used = queue.rule_actions_today(rule)
        return {"ok": True, "used": used, "allowed": cap is None or used < cap}
    if command == "log":
        return actions.log_done(queue, request["ref"], str(request["action"]), str(request.get("rule") or ""),
                                str(request.get("text") or ""))
    if command == "draft":
        return actions.save_draft(queue, request["ref"], request["text"], clients)
    if command == "get_draft":
        item = actions.require_item(queue, request["ref"])
        return {"text": queue.get_draft(item.id)}
    if command == "read":
        if request.get("all"):
            return {"marked": queue.mark_read()}
        return {"marked": queue.mark_read(request.get("refs") or [])}
    if command == "undo":
        return actions.undo(queue, int(request["action_id"]), clients)
    if command == "actions":
        return {"actions": queue.actions(int(request.get("limit", 20)))}
    if command == "ingest":
        return ingest(queue, request)
    if command == "lease":
        return queue.lease(str(request["name"]), str(request["owner"]), float(request.get("ttl", 90)), force=request.get("force") is True)
    if command == "send_plan":
        return actions.connector_send_plan(
            queue, request["ref"], request["text"], str(request["idempotency_key"]),
            str(request.get("confirm_target", "")), bool(request.get("reply_all")), str(request.get("rule", "")),
            int(request["cap"]) if isinstance(request.get("cap"), int) else None)
    if command == "send_done":
        return actions.connector_send_done(queue, request["ref"], str(request["idempotency_key"]),
                                           request.get("result"), bool(request.get("reply_all")), str(request.get("rule", "")))
    if command == "send_failed":
        return actions.connector_send_failed(queue, str(request["idempotency_key"]),
                                             str(request.get("code", "error")), str(request.get("error", "")))
    if command == "safety":
        return {"sources": {name: RateGuard(queue, name).status() for name in SAFETY_SOURCES}}
    if command == "resume":
        source = str(request["source"])
        for name in [n for n in SAFETY_SOURCES if n.split("-")[0] == source]:
            RateGuard(queue, name).resume()
        return {"ok": True}
    if command == "modes":
        return {source: modes.mode(source) for source in modes.MODES}
    if command == "set_mode":
        modes.set_mode(str(request["source"]), str(request["mode"]))
        return {"ok": True}
    raise actions.SendBlocked("unknown_command", f"Unknown command {command!r}.")


SAFETY_SOURCES = ("slack", "slack-connect", "gmail", "gmail-connector")


def ingest(queue: Queue, request: dict[str, Any]) -> dict[str, Any]:
    """Connector results → items, through the same rules and de-dup as the adapters."""
    from .adapters import gmail_connector
    from .auth import secrets
    from .rules import Priorities

    source = request.get("source")
    if source in ("calendar", "github", "jira", "slack"):
        return _ingest_records(queue, source, request)
    if source != "gmail":
        raise actions.SendBlocked("unsupported", "That source doesn't come through a connector.")
    threads = gmail_connector.threads_of(request.get("threads"))
    me = modes.gmail_me() or gmail_connector.find_me(threads) or ""
    if me and not modes.gmail_me():
        secrets.set_config(GMAIL_ME=me)
    priorities = Priorities.load()
    out = []
    for thread in threads:
        try:
            item = gmail_connector.normalize_thread(thread, me)
        except Exception:  # one odd thread never aborts the rest
            continue
        kept = priorities.apply(item) if item else None
        if kept is None:
            continue
        stored, is_new = queue.upsert(kept)
        out.append({**stored.to_json(), "new": is_new})
    return {"items": out, "me": me}


def _ingest_records(queue: Queue, source: str, request: dict[str, Any]) -> dict[str, Any]:
    """Calendar events, GitHub notifications or Jira issues from a connector, with the same rules and de-dup."""
    from . import connectors
    from .rules import Priorities

    records = request.get("records")
    records = records if isinstance(records, list) else []
    me = str(request.get("me") or "")
    assigned = request.get("assigned") is True
    if source == "slack":
        # Records are the search's Markdown, read here: {"markdown": "...", "kind": "dm" | "mention"}.
        records = [dict(one, _kind=str(chunk.get("kind") or "mention")) for chunk in records if isinstance(chunk, dict)
                   for one in connectors.slack_results(str(chunk.get("markdown") or ""))]
    convert = {"calendar": connectors.calendar_item, "github": lambda r, _me="": connectors.github_item(r),
               "jira": lambda r, m="": connectors.jira_item(r, m, assigned=assigned),
               "slack": lambda r, m="": connectors.slack_item(r, m, r.get("_kind", "mention"))}[source]
    priorities = Priorities.load()
    out = []
    for record in records[:200]:
        if not isinstance(record, dict):
            continue
        try:
            item = convert(record, me)
        except Exception:  # one odd record never aborts the rest
            continue
        kept = priorities.apply(item) if item else None
        if kept is None:
            continue
        stored, is_new = queue.upsert(kept)
        out.append({**stored.to_json(), "new": is_new})
    return {"items": out}


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if not argv:
        print(__doc__, file=sys.stderr)
        return 2
    raw = sys.stdin.read() if not sys.stdin.isatty() else ""
    try:
        request = json.loads(raw) if raw.strip() else {}
        if not isinstance(request, dict):
            raise actions.SendBlocked("bad_request", "The request must be a JSON object.")
        result = run(argv[0], request, Queue(), actions.Clients())
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except actions.SendBlocked as blocked:
        print(json.dumps(blocked.to_json(), ensure_ascii=False))
        return 1
    except Exception as exc:  # auth errors, network errors: a message, never a token
        print(json.dumps({"ok": False, "code": "error", "error": redact(str(exc))[:500]}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
