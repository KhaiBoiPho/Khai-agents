import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EffortSlider, type EffortLevel } from "./EffortSlider";

function Harness({ onChange }: { onChange(level: EffortLevel): void }) {
  const [value, setValue] = useState<EffortLevel>("low");
  return (
    <EffortSlider
      value={value}
      onChange={(level) => {
        onChange(level);
        setValue(level);
      }}
    />
  );
}

const slider = () => screen.getByRole("slider", { name: "Effort" });

/** Keys spring the thumb to a stop; let the spring settle. */
async function press(key: string) {
  fireEvent.keyDown(slider(), { key });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(800);
  });
}

describe("EffortSlider", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("offers Fast, a Medium placeholder that runs as Fast, and Smart", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    expect(slider().getAttribute("aria-valuetext")).toBe("Fast");

    await press("ArrowRight");
    expect(slider().getAttribute("aria-valuetext")).toBe("Medium");
    // Medium is a mock: the effort sent is still "low", so nothing changes.
    expect(onChange).not.toHaveBeenCalled();

    await press("ArrowRight");
    expect(slider().getAttribute("aria-valuetext")).toBe("Smart");
    expect(onChange).toHaveBeenLastCalledWith("medium");

    await press("Home");
    expect(slider().getAttribute("aria-valuetext")).toBe("Fast");
    expect(onChange).toHaveBeenLastCalledWith("low");
  });

  it("remembers the Medium stop across reopenings", async () => {
    const { unmount } = render(<Harness onChange={() => {}} />);
    await press("ArrowRight");
    unmount();
    render(<Harness onChange={() => {}} />);
    expect(slider().getAttribute("aria-valuetext")).toBe("Medium");
  });

  it("shows Smart for a session already running a higher effort", () => {
    render(<EffortSlider value="medium" onChange={() => {}} />);
    expect(slider().getAttribute("aria-valuetext")).toBe("Smart");
  });
});
