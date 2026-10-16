from __future__ import annotations

import pytest

from core.planner import operations as ops


def test_task_lifecycle_keeps_the_client_shape() -> None:
    doc, message = ops.create_task(None, {"title": "Gửi báo cáo", "due_date": "2026-10-20",
                                          "priority": "high", "subtasks": ["Nháp", "Gửi"]})
    task = doc["tasks"][0]
    assert message.startswith("Created task")
    assert task["createdBy"] == "agent" and task["status"] == "open"
    assert [s["title"] for s in task["subtasks"]] == ["Nháp", "Gửi"]

    doc, _ = ops.complete_task(doc, {"id": task["id"][:8]})
    assert doc["tasks"][0]["status"] == "done"
    assert doc["completions"][0]["taskId"] == task["id"]

    doc, _ = ops.update_task(doc, {"id": task["id"], "status": "open"})
    assert doc["completions"] == []
    assert "Gửi báo cáo" in ops.list_tasks(doc, due_before="2026-10-31")

    doc, _ = ops.delete_task(doc, {"id": "Gửi báo cáo"})
    assert doc["tasks"] == []


def test_task_validation_errors_are_actionable() -> None:
    with pytest.raises(ops.OperationError, match="due_date must be YYYY-MM-DD"):
        ops.create_task(None, {"title": "x", "due_date": "20/10/2026"})
    with pytest.raises(ops.OperationError, match="no task"):
        ops.complete_task({"tasks": [], "completions": []}, {"id": "missing"})


def test_calendar_defaults_and_range_filter() -> None:
    events, _ = ops.create_event(None, {"title": "Họp", "start": "2026-10-20T09:00"})
    assert events[0]["end"] == "2026-10-20T10:00"
    events, _ = ops.create_event(events, {"title": "Nghỉ", "start": "2026-11-02", "all_day": True})
    assert events[1]["end"] == "2026-11-02"
    listed = ops.list_events(events, start="2026-10-01", end="2026-10-31")
    assert "Họp" in listed and "Nghỉ" not in listed
    with pytest.raises(ops.OperationError, match="needs a time"):
        ops.create_event(events, {"title": "x", "start": "2026-10-21"})
    with pytest.raises(ops.OperationError, match="end must not be before start"):
        ops.create_event(events, {"title": "x", "start": "2026-10-21T10:00", "end": "2026-10-21T09:00"})


def test_notes_read_one_in_full_and_list_previews() -> None:
    doc, _ = ops.create_note(None, {"title": "Ý tưởng", "content": "a " * 200, "pinned": True})
    note_id = doc["notes"][0]["id"]
    assert len(ops.list_notes(doc).splitlines()[1]) < 200
    assert ops.read_note(doc, {"id": note_id}).startswith("# Ý tưởng")


def test_schedule_set_day_replaces_and_needs_known_types() -> None:
    doc = {"types": [{"id": "t1", "name": "Early", "shortCode": "E", "start": "06:00", "end": "14:00"}]}
    doc, _ = ops.set_schedule_day(doc, {"date": "2026-10-20", "shift": "E"})
    doc, _ = ops.set_schedule_day(doc, {"date": "2026-10-20", "shift": "free"})
    assert len(doc["overrides"]) == 1 and doc["overrides"][0]["shiftTypeId"] is None
    with pytest.raises(ops.OperationError, match="no shift type"):
        ops.add_schedule_extra(doc, {"date": "2026-10-21", "shift": "Night"})


def test_lists_are_capped() -> None:
    doc = None
    for index in range(ops.LIST_LIMIT + 5):
        doc, _ = ops.create_task(doc, {"title": f"Task {index}"})
    text = ops.list_tasks(doc)
    assert text.count("\n- [") == ops.LIST_LIMIT
    assert "5 more" in text
