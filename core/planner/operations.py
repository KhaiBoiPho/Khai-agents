"""What the agent can do to each planner document, as pure functions.

Every writer here returns ``(new_document, message)`` and never touches the
database, so the tools stay thin and the rules are testable on plain dicts.
Documents follow the browser's shapes (desktop/src/features/planner): the
client normalizes on read, so only the fields that matter are written and
unknown fields of existing items are kept as they are.

Times are the user's local wall clock, as the pages store them: dates
``YYYY-MM-DD``, times ``HH:MM``, calendar date-times ``YYYY-MM-DDTHH:MM``.
"""

from __future__ import annotations

import re
import uuid
from copy import deepcopy
from datetime import UTC, date, datetime, timedelta
from typing import Any

AGENT_ID = "agent"
OWNER_ID = "me"

TASK_STATUSES = ("open", "in_progress", "done")
TASK_PRIORITIES = ("none", "low", "medium", "high", "urgent")
TASK_CATEGORIES = ("feature", "backend", "ui", "i18n", "infra", "misc")
NOTE_COLORS = ("yellow", "orange", "red", "pink", "purple", "blue", "teal", "green", "gray", "white")
CALENDAR_COLORS = ("blue", "teal", "green", "yellow", "orange", "red", "pink", "purple", "gray")

DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME = re.compile(r"^\d{2}:\d{2}$")
DATETIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$")

LIST_LIMIT = 40


class OperationError(ValueError):
    """A request the agent should fix (missing field, unknown id, bad date)."""


# ----------------------------------------------------------------------------- helpers


def _id() -> str:
    return str(uuid.uuid4())


def _now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _text(value: Any, field: str, *, required: bool = False, limit: int = 20_000) -> str | None:
    if value is None:
        if required:
            raise OperationError(f"{field} is required")
        return None
    if not isinstance(value, str):
        raise OperationError(f"{field} must be text")
    value = value.strip()
    if required and not value:
        raise OperationError(f"{field} is required")
    return value[:limit]


def _date(value: Any, field: str) -> str | None:
    if value in (None, ""):
        return None
    if not isinstance(value, str) or not DATE.match(value):
        raise OperationError(f"{field} must be YYYY-MM-DD")
    date.fromisoformat(value)
    return value


def _time(value: Any, field: str) -> str | None:
    if value in (None, ""):
        return None
    if not isinstance(value, str) or not TIME.match(value):
        raise OperationError(f"{field} must be HH:MM")
    return value


def _choice(value: Any, field: str, options: tuple[str, ...]) -> str | None:
    if value is None:
        return None
    if value not in options:
        raise OperationError(f"{field} must be one of: {', '.join(options)}")
    return value


def _find(items: list[dict], ref: Any, kind: str) -> dict:
    """An item by id, id prefix (at least 6 characters) or exact title."""

    if not isinstance(ref, str) or not ref.strip():
        raise OperationError(f"id of the {kind} is required (from list)")
    ref = ref.strip()
    exact = [item for item in items if item.get("id") == ref]
    if exact:
        return exact[0]
    if len(ref) >= 6:
        prefixed = [item for item in items if str(item.get("id", "")).startswith(ref)]
        if len(prefixed) == 1:
            return prefixed[0]
    titled = [item for item in items if (item.get("title") or "").strip().lower() == ref.lower()]
    if len(titled) == 1:
        return titled[0]
    if len(titled) > 1:
        raise OperationError(f"several {kind}s are titled {ref!r}; use the id")
    raise OperationError(f"no {kind} {ref!r}; list them first")


def _short(item_id: str) -> str:
    return str(item_id)[:8]


def _matches(item: dict, query: str | None, *fields: str) -> bool:
    if not query:
        return True
    needle = query.lower()
    return any(needle in str(item.get(name) or "").lower() for name in fields)


# ----------------------------------------------------------------------------- tasks


def tasks_doc(value: Any) -> dict:
    doc = deepcopy(value) if isinstance(value, dict) else {}
    doc.setdefault("tasks", [])
    doc.setdefault("completions", [])
    if not isinstance(doc["tasks"], list):
        doc["tasks"] = []
    if not isinstance(doc["completions"], list):
        doc["completions"] = []
    return doc


def list_tasks(value: Any, *, status: str | None = None, query: str | None = None,
               due_before: str | None = None, include_archived: bool = False) -> str:
    doc = tasks_doc(value)
    rows = []
    for task in doc["tasks"]:
        if not include_archived and task.get("archivedAt"):
            continue
        if status and task.get("status") != status:
            continue
        if due_before and not (task.get("dueDate") and task["dueDate"] <= due_before):
            continue
        if not _matches(task, query, "title", "description"):
            continue
        rows.append(task)
    rows.sort(key=lambda t: (t.get("status") == "done", t.get("dueDate") or "9999", t.get("title") or ""))
    if not rows:
        return "No tasks match."
    lines = [f"{len(rows)} task(s):"]
    for task in rows[:LIST_LIMIT]:
        due = task.get("dueDate")
        if due and task.get("dueTime"):
            due = f"{due} {task['dueTime']}"
        bits = [task.get("status", "open")]
        if task.get("priority") not in (None, "none"):
            bits.append(task["priority"])
        if due:
            bits.append(f"due {due}")
        if task.get("recurrenceRule"):
            bits.append("repeats")
        lines.append(f"- [{_short(task['id'])}] {task.get('title')} ({', '.join(bits)})")
    if len(rows) > LIST_LIMIT:
        lines.append(f"… {len(rows) - LIST_LIMIT} more; narrow with status, query or due_before.")
    return "\n".join(lines)


def _task_fields(args: dict, *, creating: bool) -> dict:
    fields: dict[str, Any] = {}
    if creating or "title" in args:
        fields["title"] = _text(args.get("title"), "title", required=True, limit=300)
    if "description" in args:
        fields["description"] = _text(args.get("description"), "description") or ""
    if "due_date" in args:
        fields["dueDate"] = _date(args.get("due_date"), "due_date")
    if "due_time" in args:
        fields["dueTime"] = _time(args.get("due_time"), "due_time")
    if "start_date" in args:
        fields["startDate"] = _date(args.get("start_date"), "start_date")
    if "priority" in args:
        fields["priority"] = _choice(args.get("priority"), "priority", TASK_PRIORITIES) or "none"
    if "category" in args:
        fields["category"] = _choice(args.get("category"), "category", TASK_CATEGORIES) or "misc"
    if "tags" in args:
        tags = args.get("tags") or []
        if not isinstance(tags, list) or not all(isinstance(tag, str) for tag in tags):
            raise OperationError("tags must be a list of text")
        fields["tags"] = sorted({tag.strip().lower() for tag in tags if tag.strip()})
    if "recurrence" in args:
        rule = _text(args.get("recurrence"), "recurrence", limit=200)
        fields["recurrenceRule"] = rule or None
    if "status" in args:
        fields["status"] = _choice(args.get("status"), "status", TASK_STATUSES) or "open"
    if fields.get("dueTime") and not fields.get("dueDate", args.get("due_date")) and creating:
        raise OperationError("due_time needs a due_date")
    return fields


def create_task(value: Any, args: dict) -> tuple[dict, str]:
    doc = tasks_doc(value)
    stamp = _now()
    task = {
        "id": _id(), "title": "", "description": "", "status": "open", "archivedAt": None,
        "priority": "none", "category": "misc", "tags": [], "dueDate": None, "dueTime": None,
        "startDate": None, "assigneeIds": [OWNER_ID], "recurrenceRule": None,
        "recurrenceFromCompletion": False, "recurrenceOriginId": None, "seriesId": None,
        "points": 0, "subtasks": [], "comments": [], "createdBy": AGENT_ID,
        "createdAt": stamp, "updatedAt": stamp,
    }
    task.update(_task_fields(args, creating=True))
    for title in args.get("subtasks") or []:
        if isinstance(title, str) and title.strip():
            task["subtasks"].append({"id": _id(), "title": title.strip()[:300], "done": False})
    doc["tasks"].append(task)
    return doc, f"Created task [{_short(task['id'])}] {task['title']}."


def update_task(value: Any, args: dict) -> tuple[dict, str]:
    doc = tasks_doc(value)
    task = _find(doc["tasks"], args.get("id"), "task")
    fields = _task_fields(args, creating=False)
    if not fields:
        raise OperationError("nothing to change; pass the fields to update")
    previous = task.get("status")
    task.update(fields)
    task["updatedAt"] = _now()
    if fields.get("status") == "done" and previous != "done":
        _record_completion(doc, task)
    if previous == "done" and fields.get("status") not in (None, "done"):
        doc["completions"] = [c for c in doc["completions"] if c.get("taskId") != task["id"]]
    return doc, f"Updated task [{_short(task['id'])}] {task['title']}."


def _record_completion(doc: dict, task: dict) -> None:
    if any(c.get("taskId") == task["id"] for c in doc["completions"]):
        return
    doc["completions"].append({
        "id": _id(), "taskId": task["id"], "seriesId": task.get("seriesId") or task["id"],
        "userId": AGENT_ID, "doneById": None, "completedAt": _now(),
    })


def complete_task(value: Any, args: dict) -> tuple[dict, str]:
    doc = tasks_doc(value)
    task = _find(doc["tasks"], args.get("id"), "task")
    if task.get("status") == "done":
        return doc, f"Task [{_short(task['id'])}] {task['title']} was already done."
    task["status"] = "done"
    task["updatedAt"] = _now()
    _record_completion(doc, task)
    note = " It repeats: tick it in the Tasks page to schedule the next one." if task.get("recurrenceRule") else ""
    return doc, f"Marked task [{_short(task['id'])}] {task['title']} done.{note}"


def delete_task(value: Any, args: dict) -> tuple[dict, str]:
    doc = tasks_doc(value)
    task = _find(doc["tasks"], args.get("id"), "task")
    doc["tasks"] = [t for t in doc["tasks"] if t["id"] != task["id"]]
    doc["completions"] = [c for c in doc["completions"] if c.get("taskId") != task["id"]]
    return doc, f"Deleted task [{_short(task['id'])}] {task['title']}."


# ----------------------------------------------------------------------------- calendar


def calendar_doc(value: Any) -> list:
    return deepcopy(value) if isinstance(value, list) else []


def _moment(value: Any, field: str, all_day: bool) -> str | None:
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise OperationError(f"{field} must be text")
    if all_day:
        return _date(value[:10], field)
    if DATE.match(value):
        raise OperationError(f"{field} needs a time (YYYY-MM-DDTHH:MM) unless all_day is true")
    if not DATETIME.match(value[:16]):
        raise OperationError(f"{field} must be YYYY-MM-DDTHH:MM")
    datetime.fromisoformat(value[:16])
    return value[:16]


def list_events(value: Any, *, start: str | None = None, end: str | None = None,
                query: str | None = None) -> str:
    events = calendar_doc(value)
    lo = _date(start, "from") if start else None
    hi = _date(end, "to") if end else None
    rows = []
    for event in events:
        first, last = str(event.get("start", ""))[:10], str(event.get("end", ""))[:10] or str(event.get("start", ""))[:10]
        recurring = bool(event.get("rrule"))
        if not recurring:
            if lo and last < lo:
                continue
            if hi and first > hi:
                continue
        elif hi and first > hi:
            continue
        if not _matches(event, query, "title", "description", "location"):
            continue
        rows.append(event)
    rows.sort(key=lambda e: str(e.get("start", "")))
    if not rows:
        return "No events match."
    lines = [f"{len(rows)} event(s):"]
    for event in rows[:LIST_LIMIT]:
        when = event.get("start", "")
        if event.get("end") and event.get("end") != event.get("start"):
            when = f"{when} → {event['end']}"
        extra = []
        if event.get("allDay"):
            extra.append("all day")
        if event.get("rrule"):
            extra.append(f"repeats {event['rrule']}")
        if event.get("location"):
            extra.append(f"at {event['location']}")
        suffix = f" ({'; '.join(extra)})" if extra else ""
        lines.append(f"- [{_short(event['id'])}] {when} {event.get('title')}{suffix}")
    if len(rows) > LIST_LIMIT:
        lines.append(f"… {len(rows) - LIST_LIMIT} more; narrow with from/to or query.")
    return "\n".join(lines)


def _event_fields(args: dict, existing: dict | None) -> dict:
    fields: dict[str, Any] = {}
    all_day = args.get("all_day")
    if all_day is not None and not isinstance(all_day, bool):
        raise OperationError("all_day must be true or false")
    if all_day is None:
        all_day = bool(existing.get("allDay")) if existing else False
    if existing is None or "all_day" in args:
        fields["allDay"] = all_day
    if existing is None or "title" in args:
        fields["title"] = _text(args.get("title"), "title", required=True, limit=300)
    if existing is None or "start" in args:
        fields["start"] = _moment(args.get("start"), "start", all_day)
        if fields["start"] is None:
            raise OperationError("start is required")
    if "end" in args or existing is None:
        start = fields.get("start") or (existing or {}).get("start")
        end = _moment(args.get("end"), "end", all_day)
        if end is None:
            if all_day:
                end = start
            else:
                end = (datetime.fromisoformat(start) + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M")
        if end < start:
            raise OperationError("end must not be before start")
        fields["end"] = end
    for name, key in (("description", "description"), ("location", "location")):
        if name in args:
            fields[key] = _text(args.get(name), name) or ""
    if "recurrence" in args:
        fields["rrule"] = _text(args.get("recurrence"), "recurrence", limit=200) or None
    if "reminders" in args:
        reminders = args.get("reminders") or []
        if not isinstance(reminders, list) or not all(isinstance(m, int) and m >= 0 for m in reminders):
            raise OperationError("reminders must be minutes before the start, e.g. [10, 60]")
        fields["reminders"] = sorted(set(reminders))
    if "color" in args:
        fields["color"] = _choice(args.get("color"), "color", CALENDAR_COLORS)
    return fields


def create_event(value: Any, args: dict) -> tuple[list, str]:
    events = calendar_doc(value)
    event = {
        "id": _id(), "title": "", "description": "", "location": "", "allDay": False,
        "start": "", "end": "", "color": None, "icon": None, "attendeeIds": [OWNER_ID],
        "rrule": None, "exdates": [], "reminders": [], "visibility": "all",
        "countdown": False, "createdBy": AGENT_ID,
    }
    event.update(_event_fields(args, None))
    events.append(event)
    return events, f"Created event [{_short(event['id'])}] {event['start']} {event['title']}."


def update_event(value: Any, args: dict) -> tuple[list, str]:
    events = calendar_doc(value)
    event = _find(events, args.get("id"), "event")
    fields = _event_fields(args, event)
    if not fields:
        raise OperationError("nothing to change; pass the fields to update")
    event.update(fields)
    return events, f"Updated event [{_short(event['id'])}] {event['start']} {event['title']}."


def delete_event(value: Any, args: dict) -> tuple[list, str]:
    events = calendar_doc(value)
    event = _find(events, args.get("id"), "event")
    return [e for e in events if e["id"] != event["id"]], f"Deleted event [{_short(event['id'])}] {event['title']}."


# ----------------------------------------------------------------------------- notes


def notes_doc(value: Any) -> dict:
    doc = deepcopy(value) if isinstance(value, dict) else {}
    if not isinstance(doc.get("notes"), list):
        doc["notes"] = []
    if not isinstance(doc.get("categories"), list):
        doc["categories"] = []
    return doc


def list_notes(value: Any, *, query: str | None = None) -> str:
    doc = notes_doc(value)
    rows = [note for note in doc["notes"] if _matches(note, query, "title", "content")]
    rows.sort(key=lambda n: (not n.get("pinned"), str(n.get("updatedAt", ""))), reverse=False)
    rows.sort(key=lambda n: str(n.get("updatedAt", "")), reverse=True)
    rows.sort(key=lambda n: not n.get("pinned"))
    if not rows:
        return "No notes match."
    lines = [f"{len(rows)} note(s):"]
    for note in rows[:LIST_LIMIT]:
        body = " ".join(str(note.get("content", "")).split())
        preview = body[:120] + ("…" if len(body) > 120 else "")
        pin = " 📌" if note.get("pinned") else ""
        title = note.get("title") or "(untitled)"
        lines.append(f"- [{_short(note['id'])}] {title}{pin}: {preview}")
    return "\n".join(lines)


def read_note(value: Any, args: dict) -> str:
    note = _find(notes_doc(value)["notes"], args.get("id"), "note")
    title = note.get("title") or "(untitled)"
    return f"# {title}\n\n{note.get('content', '')}"


def _note_fields(args: dict, *, creating: bool) -> dict:
    fields: dict[str, Any] = {}
    if "title" in args:
        fields["title"] = _text(args.get("title"), "title", limit=300) or None
    if creating or "content" in args:
        fields["content"] = _text(args.get("content"), "content", required=creating) or ""
    if "color" in args:
        fields["color"] = _choice(args.get("color"), "color", NOTE_COLORS) or "yellow"
    if "pinned" in args:
        if not isinstance(args.get("pinned"), bool):
            raise OperationError("pinned must be true or false")
        fields["pinned"] = args["pinned"]
    return fields


def create_note(value: Any, args: dict) -> tuple[dict, str]:
    doc = notes_doc(value)
    stamp = _now()
    note = {
        "id": _id(), "title": None, "content": "", "color": "yellow", "pinned": False,
        "createdBy": AGENT_ID, "categoryIds": [], "createdAt": stamp, "updatedAt": stamp,
    }
    note.update(_note_fields(args, creating=True))
    doc["notes"].insert(0, note)
    return doc, f"Created note [{_short(note['id'])}] {note['title'] or '(untitled)'}."


def update_note(value: Any, args: dict) -> tuple[dict, str]:
    doc = notes_doc(value)
    note = _find(doc["notes"], args.get("id"), "note")
    fields = _note_fields(args, creating=False)
    if not fields:
        raise OperationError("nothing to change; pass the fields to update")
    note.update(fields)
    note["updatedAt"] = _now()
    return doc, f"Updated note [{_short(note['id'])}] {note.get('title') or '(untitled)'}."


def delete_note(value: Any, args: dict) -> tuple[dict, str]:
    doc = notes_doc(value)
    note = _find(doc["notes"], args.get("id"), "note")
    doc["notes"] = [n for n in doc["notes"] if n["id"] != note["id"]]
    return doc, f"Deleted note [{_short(note['id'])}] {note.get('title') or '(untitled)'}."


# ----------------------------------------------------------------------------- schedule


def schedule_doc(value: Any) -> dict:
    doc = deepcopy(value) if isinstance(value, dict) else {}
    doc.setdefault("version", 1)
    for name in ("types", "patterns", "overrides", "extras"):
        if not isinstance(doc.get(name), list):
            doc[name] = []
    if not isinstance(doc.get("settings"), dict):
        doc["settings"] = {"weeklyHours": {}, "overtimeEnabled": False}
    return doc


def _shift_type(doc: dict, ref: Any) -> dict:
    if not isinstance(ref, str) or not ref.strip():
        raise OperationError("shift is required (a shift type name or code from list)")
    needle = ref.strip().lower()
    for kind in doc["types"]:
        if needle in (str(kind.get("id")).lower(), str(kind.get("name", "")).lower(),
                      str(kind.get("shortCode", "")).lower()):
            return kind
    names = ", ".join(f"{t.get('name')} ({t.get('shortCode')})" for t in doc["types"]) or "none defined yet"
    raise OperationError(f"no shift type {ref!r} (types: {names}); create types in the Schedule page")


def list_schedule(value: Any, *, start: str | None = None, end: str | None = None) -> str:
    doc = schedule_doc(value)
    lo = _date(start, "from") if start else None
    hi = _date(end, "to") if end else None
    names = {t.get("id"): f"{t.get('name')} ({t.get('shortCode')})" for t in doc["types"]}
    lines = ["Shift types: " + (", ".join(
        f"{t.get('name')} [{t.get('shortCode')}] {t.get('start') or ''}–{t.get('end') or ''}".strip()
        for t in doc["types"]) or "none")]
    active = [p for p in doc["patterns"] if p.get("active", True)]
    if active:
        lines.append("Rotations: " + ", ".join(f"{p.get('name')} (every {p.get('cycleLength')} days)" for p in active))
    dated = []
    for item in doc["overrides"]:
        dated.append((item.get("date", ""), "day", item))
    for item in doc["extras"]:
        dated.append((item.get("date", ""), "extra", item))
    dated = [row for row in dated if (not lo or row[0] >= lo) and (not hi or row[0] <= hi)]
    dated.sort(key=lambda row: row[0])
    if dated:
        lines.append(f"{len(dated)} dated change(s):")
        for day, kind, item in dated[:LIST_LIMIT]:
            shift = names.get(item.get("shiftTypeId"), "free day") if item.get("shiftTypeId") else "free day"
            label = "set" if kind == "day" else "extra"
            note = f" — {item['note']}" if item.get("note") else ""
            lines.append(f"- [{_short(item['id'])}] {day} {label}: {shift}{note}")
    else:
        lines.append("No dated changes in that range (days follow the rotations).")
    return "\n".join(lines)


def set_schedule_day(value: Any, args: dict) -> tuple[dict, str]:
    """Pin one day to a shift, or to a free day (``shift`` = "free")."""

    doc = schedule_doc(value)
    day = _date(args.get("date"), "date")
    if not day:
        raise OperationError("date is required")
    ref = args.get("shift")
    shift_id = None if isinstance(ref, str) and ref.strip().lower() in ("free", "off", "none") else _shift_type(doc, ref)["id"]
    note = _text(args.get("note"), "note", limit=500) or ""
    doc["overrides"] = [o for o in doc["overrides"] if not (o.get("date") == day and o.get("memberId") == OWNER_ID)]
    doc["overrides"].append({"id": _id(), "memberId": OWNER_ID, "date": day, "shiftTypeId": shift_id, "note": note})
    return doc, f"Set {day} to {'a free day' if shift_id is None else ref}."


def add_schedule_extra(value: Any, args: dict) -> tuple[dict, str]:
    doc = schedule_doc(value)
    day = _date(args.get("date"), "date")
    if not day:
        raise OperationError("date is required")
    kind = _shift_type(doc, args.get("shift"))
    note = _text(args.get("note"), "note", limit=500) or ""
    item = {"id": _id(), "memberId": OWNER_ID, "date": day, "shiftTypeId": kind["id"], "note": note}
    doc["extras"].append(item)
    return doc, f"Added an extra {kind.get('name')} shift on {day} [{_short(item['id'])}]."


def remove_schedule_change(value: Any, args: dict) -> tuple[dict, str]:
    doc = schedule_doc(value)
    ref = args.get("id")
    for name in ("overrides", "extras"):
        try:
            item = _find(doc[name], ref, "schedule change")
        except OperationError:
            continue
        doc[name] = [entry for entry in doc[name] if entry["id"] != item["id"]]
        return doc, f"Removed the change on {item.get('date')}."
    raise OperationError(f"no dated schedule change {ref!r}; list the schedule first")


# ----------------------------------------------------------------------------- dispatch

WRITERS = {
    ("tasks", "create"): create_task,
    ("tasks", "update"): update_task,
    ("tasks", "complete"): complete_task,
    ("tasks", "delete"): delete_task,
    ("calendar", "create"): create_event,
    ("calendar", "update"): update_event,
    ("calendar", "delete"): delete_event,
    ("notes", "create"): create_note,
    ("notes", "update"): update_note,
    ("notes", "delete"): delete_note,
    ("schedule", "set_day"): set_schedule_day,
    ("schedule", "add_extra"): add_schedule_extra,
    ("schedule", "remove"): remove_schedule_change,
}


def read(module: str, value: Any, args: dict) -> str:
    if module == "tasks":
        return list_tasks(value, status=_choice(args.get("status"), "status", TASK_STATUSES),
                          query=_text(args.get("query"), "query"),
                          due_before=_date(args.get("to"), "to"),
                          include_archived=bool(args.get("include_archived")))
    if module == "calendar":
        return list_events(value, start=args.get("from"), end=args.get("to"), query=_text(args.get("query"), "query"))
    if module == "notes":
        if args.get("id"):
            return read_note(value, args)
        return list_notes(value, query=_text(args.get("query"), "query"))
    if module == "schedule":
        return list_schedule(value, start=args.get("from"), end=args.get("to"))
    raise OperationError("module must be one of: tasks, calendar, notes, schedule")
