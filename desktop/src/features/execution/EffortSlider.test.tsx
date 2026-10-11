import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EffortSlider, useEffortLabel, type EffortLevel } from "./EffortSlider";

function Harness({ onChange }: { onChange(level: EffortLevel): void }) {
  const [value, setValue] = useState<EffortLevel>("low");
  const label = useEffortLabel(value);
  return (
    <>
      <output aria-label="chip">{label}</output>
      <EffortSlider
        value={value}
        onChange={(level) => {
          onChange(level);
          setValue(level);
        }}
      />
    </>
  );
}

const slider = () => screen.getByRole("slider", { name: "Effort" });
const chip = () => screen.getByLabelText("chip").textContent;

async function press(key: string) {
  fireEvent.keyDown(slider(), { key });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(800);
  });
}

describe("EffortSlider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });
  afterEach(async () => {
    // Back to the first stop for the next test (the stop is module state).
    cleanup();
    render(<Harness onChange={() => {}} />);
    await press("Home");
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("has six stops; only the last sends the smarter effort", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    expect(chip()).toBe("Fast");
    for (const name of ["Light", "Balanced", "Medium", "Deep"]) {
      await press("ArrowRight");
      expect(slider().getAttribute("aria-valuetext")).toBe(name);
      // The chip beside the model names the stop too.
      expect(chip()).toBe(name);
    }
    expect(onChange).not.toHaveBeenCalled();
    await press("ArrowRight");
    expect(chip()).toBe("Smart");
    expect(onChange).toHaveBeenLastCalledWith("medium");
    await press("ArrowLeft");
    expect(chip()).toBe("Deep");
    expect(onChange).toHaveBeenLastCalledWith("low");
  });

  it("remembers a placeholder stop across reopenings", async () => {
    const { unmount } = render(<Harness onChange={() => {}} />);
    await press("ArrowRight");
    await press("ArrowRight");
    unmount();
    render(<Harness onChange={() => {}} />);
    expect(slider().getAttribute("aria-valuetext")).toBe("Balanced");
  });

  it("shows Smart for a session already running a higher effort", () => {
    render(<EffortSlider value="medium" onChange={() => {}} />);
    expect(slider().getAttribute("aria-valuetext")).toBe("Smart");
  });
});
