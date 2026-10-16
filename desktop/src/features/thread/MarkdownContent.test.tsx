import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MarkdownContent } from "./MarkdownContent";

describe("MarkdownContent", () => {
  afterEach(cleanup);

  it("renders GFM, safe external links, and highlighted code blocks", () => {
    const view = render(
      <MarkdownContent>
        {[
          "## Result",
          "",
          "- [x] verified",
          "",
          "| file | status |",
          "| --- | --- |",
          "| `App.tsx` | changed |",
          "",
          "[documentation](https://example.com/docs)",
          "",
          "```ts",
          "const ready = true;",
          "```",
        ].join("\n")}
      </MarkdownContent>,
    );

    expect(screen.getByRole("heading", { name: "Result" })).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByRole("checkbox")).toBeTruthy();
    const link = screen.getByRole("link", { name: "documentation" });
    expect(link.getAttribute("href")).toBe("https://example.com/docs");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(view.container.querySelector("pre")?.textContent).toContain(
      "const ready = true;",
    );
    expect(screen.getByRole("button", { name: "Copy code" })).toBeTruthy();
    expect(view.container.querySelector("script")).toBeNull();
  });

  it("does not render raw HTML from an Agent response", () => {
    const view = render(
      <MarkdownContent>
        {'Safe text\n\n<script>window.location = "https://example.com"</script>'}
      </MarkdownContent>,
    );

    expect(screen.getByText("Safe text")).toBeTruthy();
    expect(view.container.querySelector("script")).toBeNull();
    expect(screen.queryByText(/window\.location/)).toBeNull();
  });
});

describe("splitMarkdownBlocks", () => {
  it("splits at blank lines but keeps fences and indented continuations whole", async () => {
    const { splitMarkdownBlocks } = await import("./markdownBlocks");
    const text = "# Title\n\nPara one\n\n```js\na\n\nb\n```\n\n1. item\n\n   more of item\n2. next\n\nEnd";
    expect(splitMarkdownBlocks(text)).toEqual([
      "# Title\n",
      "Para one\n",
      "```js\na\n\nb\n```\n",
      "1. item\n\n   more of item\n2. next\n",
      "End",
    ]);
  });
});
