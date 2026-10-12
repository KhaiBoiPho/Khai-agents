import { describe, expect, it } from "vitest";

import { schemeFromCanvas } from "./host-scheme";

describe("schemeFromCanvas", () => {
  it("reads hex canvases", () => {
    expect(schemeFromCanvas(" #ffffff")).toBe("light");
    expect(schemeFromCanvas("#0f0f0f")).toBe("dark");
    expect(schemeFromCanvas("#f4ecd8")).toBe("light");
  });
  it("reads rgb canvases", () => {
    expect(schemeFromCanvas("rgb(20 20 20 / 92%)")).toBe("dark");
    expect(schemeFromCanvas("rgb(250, 250, 250)")).toBe("light");
  });
  it("falls back to light", () => {
    expect(schemeFromCanvas("")).toBe("light");
  });
});
