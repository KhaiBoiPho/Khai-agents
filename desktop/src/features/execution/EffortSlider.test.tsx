import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
const press = (key: string) => fireEvent.keyDown(slider(), { key });

describe("EffortSlider", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("offers Fast, a Medium placeholder that runs as Fast, and Smart", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    expect(slider().getAttribute("aria-valuetext")).toBe("Fast");
    expect(screen.getByText("Recommended")).toBeTruthy();

    press("ArrowRight");
    expect(slider().getAttribute("aria-valuetext")).toBe("Medium");
    // Medium is a mock: the effort sent is still "low", so nothing changes.
    expect(onChange).not.toHaveBeenCalled();

    press("ArrowRight");
    expect(slider().getAttribute("aria-valuetext")).toBe("Smart");
    expect(onChange).toHaveBeenLastCalledWith("medium");

    press("ArrowLeft");
    expect(slider().getAttribute("aria-valuetext")).toBe("Medium");
    expect(onChange).toHaveBeenLastCalledWith("low");

    press("Home");
    expect(slider().getAttribute("aria-valuetext")).toBe("Fast");
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("remembers the Medium stop across reopenings", () => {
    const { unmount } = render(<Harness onChange={() => {}} />);
    press("ArrowRight");
    unmount();
    render(<Harness onChange={() => {}} />);
    expect(slider().getAttribute("aria-valuetext")).toBe("Medium");
  });

  it("shows Smart for a session already running a higher effort", () => {
    render(<EffortSlider value="medium" onChange={() => {}} />);
    expect(slider().getAttribute("aria-valuetext")).toBe("Smart");
  });
});
