import { useEffect, useMemo, useState } from "react";
import { Button, Group, Modal, Select, Stack, TextInput } from "@mantine/core";
import { Editor } from "@tiptap/react";
import { v7 as uuid7 } from "uuid";
import { useParams } from "react-router-dom";
import { getAllSidebarPages, getPageById } from "@/features/page/services/page-service";
import { useCreatePageMutation } from "@/features/page/queries/page-query";
import { IPage } from "@/features/page/types/page.types";
import { extractPageSlugId } from "@/lib";

export const PAGE_INSERT_EVENT = "khaidocs:insert-page";
type Request = { editor: Editor; range?: { from: number; to: number }; mode: "child" | "in"; title?: string };

export function PageInsertDialog() {
  const { pageSlug } = useParams();
  const [request, setRequest] = useState<Request | null>(null);
  const [page, setPage] = useState<IPage | null>(null);
  const [pages, setPages] = useState<IPage[]>([]);
  const [title, setTitle] = useState("");
  const [parentPageId, setParentPageId] = useState<string | null>(null);
  const createPage = useCreatePageMutation();

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<Request>).detail;
      setRequest(detail); setTitle(detail.title ?? ""); setParentPageId(null);
    };
    window.addEventListener(PAGE_INSERT_EVENT, listener);
    return () => window.removeEventListener(PAGE_INSERT_EVENT, listener);
  }, []);

  useEffect(() => {
    if (!request) return;
    const pageId = extractPageSlugId(String(pageSlug ?? ""));
    getPageById({ pageId }).then(setPage).catch(() => setPage(null));
  }, [request, pageSlug]);

  useEffect(() => {
    if (!page?.spaceId) return;
    let cancelled = false;
    const load = async () => {
      const found = new Map<string, IPage>();
      const queue: Array<{ pageId?: string; spaceId?: string }> = [{ spaceId: page.spaceId }];
      while (queue.length) {
        const params = queue.shift()!;
        const result = await getAllSidebarPages(params);
        for (const child of result.pages.flatMap((p) => p.items ?? [])) {
          if (found.has(child.id)) continue;
          found.set(child.id, child);
          queue.push({ pageId: child.id });
        }
      }
      if (!cancelled) setPages([...found.values()]);
    };
    void load().catch(() => setPages([]));
    return () => { cancelled = true; };
  }, [page?.spaceId]);

  const options = useMemo(() => pages.map((item) => ({ value: item.id, label: item.title || "Untitled" })), [pages]);
  const submit = async () => {
    if (!request || !page) return;
    const parent = request.mode === "child" ? page.id : parentPageId;
    if (!parent) return;
    const created = await createPage.mutateAsync({ title: title.trim() || "Untitled", spaceId: page.spaceId, parentPageId: parent });
    if (request.range) {
      const { editor, range } = request;
      const node = editor.schema.nodes.mention.create({ id: uuid7(), label: created.title, entityType: "page", entityId: created.id, slugId: created.slugId, creatorId: created.creatorId });
      editor.chain().focus().deleteRange(range).insertContent(node.toJSON()).run();
    }
    setRequest(null);
  };

  return <Modal opened={!!request} onClose={() => setRequest(null)} title={request?.mode === "child" ? "Create child page" : "Create page in…"} centered>
    <Stack>
      <TextInput label="Page title" value={title} onChange={(event) => setTitle(event.currentTarget.value)} autoFocus />
      {request?.mode === "in" ? <Select label="Parent page" placeholder="Choose a page" data={options} value={parentPageId} onChange={setParentPageId} searchable nothingFoundMessage="No pages found" /> : null}
      <Group justify="flex-end"><Button variant="default" onClick={() => setRequest(null)}>Cancel</Button><Button onClick={() => void submit()} loading={createPage.isPending} disabled={request?.mode === "in" && !parentPageId}>Create</Button></Group>
    </Stack>
  </Modal>;
}
