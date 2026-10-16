import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { confirmAction, setConfirmHandler } from "./confirmAction";

describe("confirmAction", () => {
  beforeEach(() => {
    setConfirmHandler(async (message) => window.confirm(message));
  });

  afterEach(() => vi.restoreAllMocks());

  it("uses the browser dialog by default", async () => {
    const browserConfirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    await expect(confirmAction("Continue?")).resolves.toBe(true);

    expect(browserConfirm).toHaveBeenCalledWith("Continue?");
  });

  it("routes through a custom handler when one is set", async () => {
    const handler = vi.fn(async () => false);
    setConfirmHandler(handler);

    await expect(confirmAction("Delete?", { kind: "warning" })).resolves.toBe(false);

    expect(handler).toHaveBeenCalledWith("Delete?", { kind: "warning" });
  });
});
