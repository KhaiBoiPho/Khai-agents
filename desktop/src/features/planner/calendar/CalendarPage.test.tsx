import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { __resetEscapeLayersForTests } from "../../../app/escapeLayer";
import { CalendarPage } from "./CalendarPage";
import { formatWeekdayDate } from "./dates";
import { periodLabel } from "./periods";

// The sibling modules' feeds are replaced by one item each, so these tests
// see the Calendar's own seed plus a known task and shift.
vi.mock("../tasks/calendarFeed", () => ({
  readCalendarTasks: (from: string, to: string) =>
    "2026-10-07" >= from && "2026-10-07" <= to
      ? [{ id: "t1", title: "File expense report", dueDate: "2026-10-07", done: false, priority: "high", assigneeIds: ["me"] }]
      : [],
}));
vi.mock("../schedule/calendarFeed", () => ({
  readScheduleOccurrences: (from: string, to: string) =>
    "2026-10-06" >= from && "2026-10-06" <= to
      ? [{ id: "s1", date: "2026-10-06", label: "Early shift", start: "06:00", end: "14:00", color: "#157f3d", memberId: "linh" }]
      : [],
}));

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const dayName = (day: string) => new RegExp(escape(formatWeekdayDate(day, true)));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 6, 10, 0));
  try {
    localStorage.clear();
  } catch {
    // Storage may be unavailable; the page falls back to its seed.
  }
});

afterEach(() => {
  cleanup();
  __resetEscapeLayersForTests();
  vi.useRealTimers();
});

it("renders the month with seeded events, layers and the period header", () => {
  render(<CalendarPage />);
  expect(screen.getByRole("button", { name: /October 2026/ })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Month" }).getAttribute("aria-selected")).toBe("true");
  const grid = screen.getByRole("grid", { name: "Month" });
  const today = within(grid).getByRole("gridcell", { name: dayName("2026-10-06") });
  expect(today.getAttribute("tabindex")).toBe("0");
  expect(today.getAttribute("aria-label")).toMatch(/Today/);
  expect(within(grid).getByText("File expense report")).toBeTruthy();
  expect(within(grid).getByText("Early shift")).toBeTruthy();
  expect(within(grid).getAllByText("Daily code review run").length).toBeGreaterThan(0);
  // Minh's birthday (19 October) comes from the birthdays layer.
  expect(within(grid).getByText("Minh's birthday")).toBeTruthy();
});

it("switches views from the tabs and the keyboard", () => {
  render(<CalendarPage />);
  fireEvent.click(screen.getByRole("tab", { name: "Week" }));
  expect(screen.getByRole("button", { name: /^W41/ })).toBeTruthy();
  expect(screen.getAllByText("all day").length).toBe(1);

  fireEvent.keyDown(window, { key: "d" });
  expect(screen.getByRole("tab", { name: "Day" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("button", { name: formatWeekdayDate("2026-10-06", true) })).toBeTruthy();
  expect(screen.getByRole("complementary", { name: "Coming up" })).toBeTruthy();

  fireEvent.keyDown(window, { key: "a" });
  expect(screen.getByRole("tab", { name: "Agenda" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByText("Choose an event")).toBeTruthy();

  fireEvent.keyDown(window, { key: "j" });
  expect(screen.getByRole("button", { name: periodLabel("agenda", "2026-11-05", 1) })).toBeTruthy();
  fireEvent.keyDown(window, { key: "t" });
  expect(screen.getByRole("button", { name: periodLabel("agenda", "2026-10-06", 1) })).toBeTruthy();
});

it("moves through the month grid with arrow keys and opens a day with Enter", () => {
  render(<CalendarPage />);
  const grid = screen.getByRole("grid", { name: "Month" });
  const today = within(grid).getByRole("gridcell", { name: dayName("2026-10-06") });
  today.focus();
  fireEvent.keyDown(today, { key: "ArrowDown" });
  const next = within(grid).getByRole("gridcell", { name: dayName("2026-10-13") });
  expect(next.getAttribute("tabindex")).toBe("0");
  fireEvent.keyDown(next, { key: "Enter" });
  expect(screen.getByRole("tab", { name: "Day" }).getAttribute("aria-selected")).toBe("true");
});

it("creates an event, then deletes it with undo", () => {
  render(<CalendarPage />);
  fireEvent.keyDown(window, { key: "d" });
  fireEvent.click(screen.getByRole("button", { name: /New event/ }));
  const dialog = screen.getByRole("dialog", { name: "New Event" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
  expect(within(dialog).getByRole("alert").textContent).toBe("Title is required");

  fireEvent.change(within(dialog).getByRole("textbox", { name: /Title/ }), { target: { value: "Ship calendar port" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
  expect(screen.queryByRole("dialog", { name: "New Event" })).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("Event created");

  fireEvent.click(screen.getByText("Ship calendar port"));
  const detail = screen.getByRole("dialog", { name: "Details" });
  expect(within(detail).getByText("Local calendar")).toBeTruthy();
  fireEvent.click(within(detail).getByRole("button", { name: /Delete/ }));
  expect(screen.queryByText("Ship calendar port")).toBeNull();

  act(() => {
    fireEvent.click(screen.getByRole("button", { name: /Undo/ }));
  });
  expect(screen.getByText("Ship calendar port")).toBeTruthy();
});

it("asks which occurrences a recurring delete applies to", () => {
  render(<CalendarPage />);
  fireEvent.click(screen.getByRole("tab", { name: "Agenda" }));
  const rows = screen.getAllByRole("button", { name: /Recurring event, Backup snapshot/ });
  fireEvent.click(rows[0]!);
  fireEvent.click(screen.getByRole("button", { name: /Delete/ }));
  const scope = screen.getByRole("dialog", { name: "Delete recurring event" });
  const before = screen.getAllByRole("button", { name: /Backup snapshot/ }).length;
  fireEvent.click(within(scope).getByRole("button", { name: "Only this event" }));
  expect(screen.getAllByRole("button", { name: /Backup snapshot/ }).length).toBe(before - 1);
});

it("filters out a layer and counts the active filter", () => {
  render(<CalendarPage />);
  fireEvent.click(screen.getByRole("button", { name: "Open filters" }));
  const panel = screen.getByRole("dialog", { name: "Filters" });
  fireEvent.click(within(panel).getByRole("switch", { name: /Birthdays/ }));
  expect(screen.queryByText("Minh's birthday")).toBeNull();
  expect(screen.getByRole("button", { name: "Filters, 1 active" })).toBeTruthy();
});

it("finds events by search", () => {
  render(<CalendarPage />);
  fireEvent.keyDown(window, { key: "/" });
  const input = screen.getByRole("searchbox", { name: /Search by title/ });
  fireEvent.change(input, { target: { value: "offsite" } });
  expect(screen.getByText("1 result")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Offsite: roadmap planning/ }));
  expect(screen.getByRole("tab", { name: "Day" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("dialog", { name: "Details" })).toBeTruthy();
});
