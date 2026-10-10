import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CSSProperties } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReviewResizer } from "./ReviewResizer";

describe("ReviewResizer", () => {
  const initialInnerWidth = window.innerWidth;
  afterEach(() => {
    cleanup();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: initialInnerWidth });
  });

  it("previews on the shell's custom property and commits once, on release", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1600 });
    const onResize = vi.fn();
    const { container } = render(
      <main style={{ "--review-width": "640px" } as CSSProperties}>
        <section>
          <ReviewResizer width={640} sidebarWidth={264} onResize={onResize} />
        </section>
      </main>,
    );
    const shell = container.querySelector("main")!;
    const handle = screen.getByRole("separator", { name: "Resize review panel" });

    fireEvent.pointerDown(handle, { clientX: 960 });
    fireEvent.pointerMove(window, { clientX: 900 });
    fireEvent.pointerMove(window, { clientX: 850 });

    expect(onResize).not.toHaveBeenCalled();
    expect(shell.style.getPropertyValue("--review-width")).toBe("750px");
    expect(handle.getAttribute("aria-valuenow")).toBe("750");

    fireEvent.pointerUp(window);

    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize).toHaveBeenCalledWith(750);
  });

  it("does not commit a press that never moved", () => {
    const onResize = vi.fn();
    render(
      <main style={{ "--review-width": "640px" } as CSSProperties}>
        <ReviewResizer width={640} sidebarWidth={264} onResize={onResize} />
      </main>,
    );
    const handle = screen.getByRole("separator", { name: "Resize review panel" });

    fireEvent.pointerDown(handle, { clientX: 960 });
    fireEvent.pointerUp(window);

    expect(onResize).not.toHaveBeenCalled();
  });
});
