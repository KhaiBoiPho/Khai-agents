import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Item } from "../../generated/app-server";
import { subscribeFilePreview } from "../inspector/filePreviewRequests";
import { DocumentCards } from "./DocumentCards";
import { DocumentDownloadContext, formatFileSize, turnDocuments } from "./documentFiles";

function toolItem(
  id: string,
  documents: unknown,
  status: Item["status"] = "completed",
): Item {
  return {
    id,
    kind: "tool_call",
    status,
    summary: "mcp__genoffice__create_docx",
    payload: { name: "mcp__genoffice__create_docx", documents },
  } as unknown as Item;
}

describe("turnDocuments", () => {
  it("collects completed documents once per path, latest size wins", () => {
    const items = [
      toolItem("a", [{ path: "reports/q3.docx", name: "q3.docx", extension: "docx", sizeBytes: 10 }]),
      toolItem("b", [{ path: "decks/pitch.pptx", name: "pitch.pptx", extension: "pptx", sizeBytes: 2048 }]),
      toolItem("c", [{ path: "reports/q3.docx", name: "q3.docx", extension: "docx", sizeBytes: 20 }]),
      toolItem("d", [{ path: "failed.xlsx" }], "failed"),
      toolItem("e", "not a list"),
    ];
    expect(turnDocuments(items)).toEqual([
      { path: "reports/q3.docx", name: "q3.docx", extension: "docx", sizeBytes: 20, alternates: [] },
      { path: "decks/pitch.pptx", name: "pitch.pptx", extension: "pptx", sizeBytes: 2048, alternates: [] },
    ]);
  });

  it("folds a deck's other formats, and its earlier HTML card, into one card", () => {
    const items = [
      toolItem("w", [{ path: "decks/t/t.html", name: "t.html", extension: "html", sizeBytes: 9 }]),
      toolItem("b", [
        {
          path: "decks/t/t.pdf",
          name: "t.pdf",
          extension: "pdf",
          sizeBytes: 100,
          alternates: [
            { path: "decks/t/t.pptx", name: "t.pptx", extension: "pptx", sizeBytes: 200 },
            { path: "decks/t/t.html", name: "t.html", extension: "html", sizeBytes: 9 },
          ],
        },
      ]),
    ];
    const documents = turnDocuments(items);
    expect(documents.map((document) => document.path)).toEqual(["decks/t/t.pdf"]);
    expect(documents[0].alternates.map((alt) => alt.extension)).toEqual(["pptx", "html"]);
  });

  it("formats sizes compactly", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(15 * 1024 * 1024)).toBe("15 MB");
    expect(formatFileSize(null)).toBeNull();
  });
});

describe("DocumentCards", () => {
  afterEach(cleanup);

  it("renders nothing without documents", () => {
    const { container } = render(<DocumentCards documents={[]} onOpenInspector={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("opens the file in the Files tab", () => {
    const onOpenInspector = vi.fn();
    const opened: string[] = [];
    const unsubscribe = subscribeFilePreview((path) => opened.push(path));
    render(
      <DocumentCards
        documents={[
          { path: "decks/pitch.pptx", name: "pitch.pptx", extension: "pptx", sizeBytes: 8157, alternates: [] },
        ]}
        onOpenInspector={onOpenInspector}
      />,
    );
    expect(screen.getByText("pitch.pptx")).toBeTruthy();
    expect(screen.getByText("PowerPoint deck · 8.0 KB")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /pitch\.pptx/ }));
    expect(onOpenInspector).toHaveBeenCalledWith("files");
    expect(opened).toEqual(["decks/pitch.pptx"]);
    unsubscribe();
  });

  it("delivers a request made before the Files panel subscribes", () => {
    render(
      <DocumentCards
        documents={[
          { path: "reports/q3.docx", name: "q3.docx", extension: "docx", sizeBytes: null, alternates: [] },
        ]}
        onOpenInspector={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /q3\.docx/ }));
    const opened: string[] = [];
    const unsubscribe = subscribeFilePreview((path) => opened.push(path));
    expect(opened).toEqual(["reports/q3.docx"]);
    unsubscribe();
  });

  it("offers each format of a deck for download from one card", () => {
    const download = vi.fn();
    render(
      <DocumentDownloadContext.Provider value={download}>
        <DocumentCards
          documents={[
            {
              path: "decks/t/t.pdf",
              name: "t.pdf",
              extension: "pdf",
              sizeBytes: 2048,
              alternates: [
                { path: "decks/t/t.pptx", name: "t.pptx", extension: "pptx", sizeBytes: 4096, alternates: [] },
              ],
            },
          ]}
          onOpenInspector={() => {}}
        />
      </DocumentDownloadContext.Provider>,
    );
    expect(screen.getByText("PDF · 2.0 KB · also PPTX")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Download t\.pdf as/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /PowerPoint deck/ }));
    expect(download).toHaveBeenCalledWith("decks/t/t.pptx");
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
