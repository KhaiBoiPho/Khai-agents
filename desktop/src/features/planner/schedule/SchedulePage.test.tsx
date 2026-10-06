import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { SchedulePage } from "./SchedulePage";

beforeEach(() => {
  // Storage is unavailable here; the page must still render from its seed.
  vi.stubGlobal("localStorage", undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("renders every view from the seed and opens the create flows", () => {
  render(<SchedulePage />);
  expect(screen.getByRole("heading", { name: "Schedule" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "Today" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "Week grid" })).toBeTruthy();

  fireEvent.click(screen.getByRole("tab", { name: "Month" }));
  expect(screen.getByRole("region", { name: "Month roster" })).toBeTruthy();
  expect(screen.getAllByRole("rowheader").length).toBeGreaterThanOrEqual(4);

  fireEvent.click(screen.getByRole("tab", { name: "Planning" }));
  expect(screen.getByText("Nightly maintenance")).toBeTruthy();
  expect(screen.getByText("Support rotation")).toBeTruthy();

  fireEvent.click(screen.getByRole("tab", { name: "Shift types" }));
  expect(screen.getByText("Maintenance window")).toBeTruthy();

  fireEvent.click(screen.getByRole("tab", { name: "Statistics" }));
  expect(screen.getAllByText("Total hours").length).toBeGreaterThan(0);

  fireEvent.click(screen.getByRole("button", { name: "New schedule entry" }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: /Schedule plan/ }));
  const dialog = screen.getByRole("dialog", { name: "New schedule plan" });
  expect(within(dialog).getByText("Cycle starts on")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("creates a shift type through the dialog", () => {
  render(<SchedulePage />);
  fireEvent.click(screen.getByRole("tab", { name: "Shift types" }));
  fireEvent.click(screen.getByRole("button", { name: /Add shift type/ }));
  const dialog = screen.getByRole("dialog", { name: "Add shift type" });
  fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Pairing session" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByText("Pairing session")).toBeTruthy();
});
