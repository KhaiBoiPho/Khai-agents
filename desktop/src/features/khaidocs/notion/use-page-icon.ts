/*
 * Original KhaiDocs code, MIT.
 *
 * Sets or clears a page's icon the way Docmost's sidebar does: optimistic
 * tree update, POST /api/pages/update, then a websocket "updateOne" so other
 * open tabs follow.
 */

import { useCallback } from "react";
import { useSetAtom } from "jotai";
import { useUpdatePageMutation } from "@/features/page/queries/page-query.ts";
import { treeDataAtom } from "@/features/page/tree/atoms/tree-data-atom.ts";
import { updateTreeNodeIcon } from "@/features/page/tree/utils/utils.ts";
import { useQueryEmit } from "@/features/websocket/use-query-emit.ts";
import { updateRecentPage } from "./recents";

export function useSetPageIcon() {
  const setTreeData = useSetAtom(treeDataAtom);
  const updatePageMutation = useUpdatePageMutation();
  const emit = useQueryEmit();

  return useCallback(
    async (page: { id: string; spaceId: string }, icon: string | null) => {
      setTreeData((prev) => updateTreeNodeIcon(prev, page.id, icon));
      updateRecentPage(page.id, { icon });
      const data = await updatePageMutation.mutateAsync({
        pageId: page.id,
        icon,
      });
      setTimeout(() => {
        emit({
          operation: "updateOne",
          spaceId: page.spaceId,
          entity: ["pages"],
          id: page.id,
          payload: { icon, parentPageId: data?.parentPageId },
        });
      }, 50);
      return data;
    },
    [setTreeData, updatePageMutation, emit],
  );
}
