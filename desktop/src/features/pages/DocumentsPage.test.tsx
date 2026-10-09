import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DocumentEntry } from "../../generated/app-server";
import type { ClientRuntime } from "../../rpc/contracts";
import { DocumentsPage } from "./DocumentsPage";

const document: DocumentEntry = {
  id: "doc-1",
  name: "report.pdf",
  path: "reports/report.pdf",
  threadId: "thread-1",
  threadTitle: "Write the report",
  projectId: "project-1",
  projectName: "Project",
  source: "agent",
  size: 1024,
  modifiedAt: "2026-10-09T08:00:00Z",
  extension: "pdf",
  linked: true,
};

describe("DocumentsPage", () => {
  afterEach(cleanup);

  it("previews a selected file in place and opens its source chat only on request", async () => {
    const runtime = {
      request: vi.fn().mockResolvedValue({ documents: [document] }),
      readFileBytes: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    } as unknown as ClientRuntime;
    const onOpen = vi.fn();

    render(<DocumentsPage runtime={runtime} onOpen={onOpen} />);
    await screen.findByText("report.pdf");
    fireEvent.click(screen.getByTitle("Preview report.pdf"));

    expect(onOpen).not.toHaveBeenCalled();
    expect(await screen.findByLabelText("Preview report.pdf")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Open source chat/ }));
    expect(onOpen).toHaveBeenCalledWith(document);
  });
});
