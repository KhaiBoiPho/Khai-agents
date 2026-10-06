import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { AppsPage } from "./AppsPage";
import { mockAppAuthClient } from "./appAuthClient";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("lists apps with their seeded connection states", async () => {
  render(<AppsPage />);

  const github = (await screen.findByText("GitHub")).closest("article")!;
  expect(within(github).getByText("Connected")).toBeTruthy();
  const notion = screen.getByText("Notion").closest("article")!;
  expect(within(notion).getByText("Expired")).toBeTruthy();
  const gmail = screen.getByText("Gmail").closest("article")!;
  expect(within(gmail).getByText("Not connected")).toBeTruthy();
});

it("filters to connected apps and by search", async () => {
  render(<AppsPage />);
  await screen.findByText("GitHub");

  fireEvent.click(screen.getByRole("tab", { name: "Connected" }));
  expect(screen.queryByText("Gmail")).toBeNull();
  expect(screen.getByText("GitHub")).toBeTruthy();

  fireEvent.click(screen.getByRole("tab", { name: "All" }));
  fireEvent.change(screen.getByLabelText("Search apps"), { target: { value: "stri" } });
  expect(screen.getByText("Stripe")).toBeTruthy();
  expect(screen.queryByText("GitHub")).toBeNull();
});

it("settles a mock connection from initiated to active", async () => {
  vi.useFakeTimers();
  const { connection, redirectUrl } = await mockAppAuthClient.connect("gmail");
  expect(connection.status).toBe("initiated");
  expect(redirectUrl).toContain("gmail");

  const settling = mockAppAuthClient.waitForConnection(connection.id);
  await vi.advanceTimersByTimeAsync(1500);
  await expect(settling).resolves.toMatchObject({ status: "active", toolkitSlug: "gmail" });

  const removing = mockAppAuthClient.disconnect(connection.id);
  await vi.advanceTimersByTimeAsync(300);
  await removing;
});
