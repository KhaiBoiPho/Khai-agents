import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { TasksPage } from "./TasksPage";

afterEach(cleanup);

it("renders the seeded plan grouped by due date", () => {
  render(<TasksPage />);
  expect(screen.getByRole("heading", { level: 1, name: "Plan" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Split view for multiple chats" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Overdue" })).toBeTruthy();
  // Done tasks and future-start tasks stay out of the default list.
  expect(screen.queryByRole("button", { name: "Plain chats without a project" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Write 0.2 release notes" })).toBeNull();
});

it("adds a task, opens its detail and deletes it with undo", () => {
  render(<TasksPage />);
  const input = screen.getByLabelText("New task");
  fireEvent.change(input, { target: { value: "Ship the tasks page" } });
  fireEvent.submit(input.closest("form")!);
  fireEvent.click(screen.getByRole("button", { name: "Ship the tasks page" }));

  const panel = screen.getByRole("complementary", { name: "Task: Ship the tasks page" });
  fireEvent.click(within(panel).getByRole("button", { name: "More actions" }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: /Delete task/ }));
  expect(screen.queryByRole("button", { name: "Ship the tasks page" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(screen.getByRole("button", { name: "Ship the tasks page" })).toBeTruthy();
});

it("filters by search and shows a named empty state", () => {
  render(<TasksPage />);
  fireEvent.change(screen.getByLabelText("Search tasks"), { target: { value: "zzz-nothing" } });
  expect(screen.getByText("No task contains “zzz-nothing”.")).toBeTruthy();
});

it("completes a recurring task and offers to undo the follow-up", () => {
  render(<TasksPage />);
  fireEvent.click(screen.getByRole("button", { name: "Mark Weekly dependency audit as done" }));
  expect(screen.getByRole("status").textContent).toMatch(/next one due/);
});

it("switches to the board and the history", () => {
  render(<TasksPage />);
  fireEvent.click(screen.getByRole("tab", { name: /Board/ }));
  expect(screen.getByRole("button", { name: /In progress/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Plain chats without a project" })).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: /History/ }));
  expect(screen.getByRole("group", { name: "Filter by person" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Settings in the desktop style" })).toBeTruthy();
});
