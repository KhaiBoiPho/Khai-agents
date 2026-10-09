import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  nativeConfirm: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: mocks.nativeConfirm,
  open: vi.fn(),
}));

import { confirmAction, setConfirmHandler } from "./confirmAction";

describe("confirmAction", () => {
  beforeEach(() => {
    setConfirmHandler(async (message) => window.confirm(message));
    mocks.nativeConfirm.mockReset();
  });

  afterEach(() => vi.restoreAllMocks());

  it("uses the synchronous browser dialog outside Tauri", async () => {
    const browserConfirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    await expect(confirmAction("Continue?")).resolves.toBe(true);

    expect(browserConfirm).toHaveBeenCalledWith("Continue?");
    expect(mocks.nativeConfirm).not.toHaveBeenCalled();
  });
});
