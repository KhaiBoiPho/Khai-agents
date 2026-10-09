import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CitationContext, linkCitations, parseCitationHref } from "./citations";
import { MarkdownContent } from "./MarkdownContent";

describe("citations", () => {
  it("links every citation form and round-trips its target", () => {
    const text = linkCitations(
      "See 【README.md:196-L201】, 【src/a.ts:L3-L4】, 【./b.py:7】 and 【x.md:9 - 12】.",
    );
    const hrefs = [...text.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1]);
    expect(hrefs.map(parseCitationHref)).toEqual([
      { path: "README.md", lines: { start: 196, end: 201 } },
      { path: "src/a.ts", lines: { start: 3, end: 4 } },
      { path: "b.py", lines: { start: 7, end: 7 } },
      { path: "x.md", lines: { start: 9, end: 12 } },
    ]);
  });

  it("leaves malformed citations and ordinary links alone", () => {
    expect(linkCitations("【README.md:20-L10】")).toBe("【README.md:20-L10】");
    expect(linkCitations("【no line number】")).toBe("【no line number】");
    expect(parseCitationHref("https://example.com")).toBeNull();
  });

  it("opens the cited lines only where a conversation handles citations", () => {
    const open = vi.fn();
    render(
      <CitationContext.Provider value={open}>
        <MarkdownContent>{"Read 【README.md:196-L201】."}</MarkdownContent>
      </CitationContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /README\.md:196-201/ }));
    expect(open).toHaveBeenCalledWith("README.md", { start: 196, end: 201 });

    render(<MarkdownContent>{"Plain 【notes.md:1】."}</MarkdownContent>);
    expect(screen.getByText(/Plain 【notes\.md:1】\./)).toBeTruthy();
  });
});
