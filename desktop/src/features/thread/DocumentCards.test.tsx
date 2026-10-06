import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Item } from "../../generated/app-server";
import { subscribeFilePreview } from "../inspector/filePreviewRequests";
import { DocumentCards } from "./DocumentCards";
import { formatFileSize, turnDocuments } from "./documentFiles";

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
      { path: "reports/q3.docx", name: "q3.docx", extension: "docx", sizeBytes: 20 },
      { path: "decks/pitch.pptx", name: "pitch.pptx", extension: "pptx", sizeBytes: 2048 },
    ]);
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
        documents={[{ path: "decks/pitch.pptx", name: "pitch.pptx", extension: "pptx", sizeBytes: 8157 }]}
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
        documents={[{ path: "reports/q3.docx", name: "q3.docx", extension: "docx", sizeBytes: null }]}
        onOpenInspector={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /q3\.docx/ }));
    const opened: string[] = [];
    const unsubscribe = subscribeFilePreview((path) => opened.push(path));
    expect(opened).toEqual(["reports/q3.docx"]);
    unsubscribe();
  });
});
