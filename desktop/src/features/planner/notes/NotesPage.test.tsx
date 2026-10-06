import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { NotesPage } from "./NotesPage";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const card = (name: string) =>
  screen.getByRole("button", { name: `Open ${name}` }).closest("article")!;

it("renders the seeded board with pinned and other groups", () => {
  render(<NotesPage />);
  expect(screen.getByRole("heading", { level: 1, name: "Notes" })).toBeTruthy();
  expect(
    screen.getByRole("heading", { level: 2, name: "Pinned" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("heading", { level: 2, name: "Other notes" }),
  ).toBeTruthy();
  // Titles drop to h3 under the group heads.
  expect(
    screen.getByRole("heading", { level: 3, name: "Release checklist" }),
  ).toBeTruthy();
  expect(within(card("Ideas")).getByText("Vietnamese UI")).toBeTruthy();
});

it("ticks a checklist box on the card without opening the note", () => {
  render(<NotesPage />);
  const release = card("Release checklist");
  const box = within(release).getByRole("checkbox", {
    name: /Smoke-test the web build/,
  });
  expect(box.getAttribute("aria-checked")).toBe("false");

  fireEvent.click(box);

  expect(
    within(card("Release checklist"))
      .getByRole("checkbox", { name: /Smoke-test the web build/ })
      .getAttribute("aria-checked"),
  ).toBe("true");
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("searches and shows a no-results state", () => {
  render(<NotesPage />);
  const search = screen.getByLabelText("Search notes");
  fireEvent.change(search, { target: { value: "tab-manager" } });
  expect(
    screen.getByRole("button", { name: "Open Learning the shell" }),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Open Ideas" })).toBeNull();

  fireEvent.change(search, { target: { value: "zzz-nothing" } });
  expect(screen.getByRole("status").textContent).toContain("No note contains");
});

it("pins a note to the front", () => {
  render(<NotesPage />);
  fireEvent.click(within(card("Ideas")).getByRole("button", { name: "Pin" }));
  const opens = screen
    .getAllByRole("button", { name: /^Open / })
    .map((el) => el.getAttribute("aria-label"));
  expect(opens.indexOf("Open Ideas")).toBeLessThan(
    opens.indexOf("Open Learning the shell"),
  );
  expect(
    within(card("Ideas")).getByRole("button", { name: "Unpin" }),
  ).toBeTruthy();
});

it("deletes with undo", () => {
  vi.useFakeTimers();
  render(<NotesPage />);
  fireEvent.click(screen.getByRole("button", { name: "Delete Ideas" }));
  expect(screen.queryByRole("button", { name: "Open Ideas" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(screen.getByRole("button", { name: "Open Ideas" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Delete Ideas" }));
  act(() => {
    vi.advanceTimersByTime(6000);
  });
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Open Ideas" })).toBeNull();
});

it("creates a note through the dialog and requires content", () => {
  render(<NotesPage />);
  fireEvent.click(screen.getByRole("button", { name: "New note" }));
  const dialog = screen.getByRole("dialog", { hidden: true });

  fireEvent.click(
    within(dialog).getByRole("button", { name: "Create", hidden: true }),
  );
  expect(within(dialog).getByText("Content is required.")).toBeTruthy();

  fireEvent.change(within(dialog).getByLabelText("Title (optional)"), {
    target: { value: "Standup" },
  });
  fireEvent.change(within(dialog).getByLabelText(/^Content/), {
    target: { value: "- [ ] Share the demo" },
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Create", hidden: true }),
  );

  expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
  expect(
    within(card("Standup")).getByRole("checkbox", { name: /Share the demo/ }),
  ).toBeTruthy();
});

it("opens an existing note in Read view and ticks there too", () => {
  render(<NotesPage />);
  fireEvent.click(
    screen.getByRole("button", { name: "Open Welcome to Notes" }),
  );
  const dialog = screen.getByRole("dialog", { hidden: true });
  const readTab = within(dialog).getByRole("tab", {
    name: "Read",
    hidden: true,
  });
  expect(readTab.getAttribute("aria-selected")).toBe("true");

  const box = within(dialog).getByRole("checkbox", {
    name: /Tick a box/,
    hidden: true,
  });
  fireEvent.click(box);
  expect(
    within(dialog)
      .getByRole("checkbox", { name: /Tick a box/, hidden: true })
      .getAttribute("aria-checked"),
  ).toBe("true");
  // The card behind follows the same source.
  expect(
    within(card("Welcome to Notes"))
      .getByRole("checkbox", { name: /Tick a box/, hidden: true })
      .getAttribute("aria-checked"),
  ).toBe("true");
});
