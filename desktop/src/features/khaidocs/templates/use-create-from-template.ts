/*
 * Original KhaiDocs code, MIT.
 *
 * "New page from template": sends the template's Markdown to Docmost's core
 * import endpoint (POST /api/pages/import, multipart `spaceId` + `file`),
 * gives the page the template's icon, adds it to the sidebar tree and opens
 * it — the same steps the core import modal and "New page" take.
 */

import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSetAtom } from "jotai";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import { importPage, updatePage } from "@/features/page/services/page-service.ts";
import { buildPageUrl } from "@/features/page/page.utils.ts";
import { treeDataAtom } from "@/features/page/tree/atoms/tree-data-atom.ts";
import { buildTree, updateSpaceRoots } from "@/features/page/tree/utils";
import { useQueryEmit } from "@/features/websocket/use-query-emit.ts";
import { queryClient } from "@/main.tsx";
import type { IPage } from "@/features/page/types/page.types.ts";
import type { PageTemplate } from "./manifest";
import { buildTemplateDocument } from "./template-markdown";

export function useCreatePageFromTemplate(space: {
  id?: string;
  slug?: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setTreeData = useSetAtom(treeDataAtom);
  const emit = useQueryEmit();
  const [creatingId, setCreatingId] = useState<string | null>(null);

  const create = useCallback(
    async (template: PageTemplate): Promise<IPage | null> => {
      if (!space.id || !space.slug) return null;
      setCreatingId(template.id);
      try {
        const doc = buildTemplateDocument(template);
        const file = new File([doc.markdown], doc.fileName, {
          type: "text/markdown",
        });
        let page = await importPage(file, space.id);

        if (template.icon) {
          try {
            await updatePage({ pageId: page.id, icon: template.icon });
            page = { ...page, icon: template.icon };
          } catch {
            // the page exists; an icon is a nicety
          }
        }

        const [node] = buildTree([page]);
        if (node) {
          let index = 0;
          setTreeData((prev) =>
            updateSpaceRoots(prev, space.id!, (roots) => {
              if (roots.some((root) => root.id === node.id)) return roots;
              index = roots.length;
              return [...roots, node];
            }),
          );
          setTimeout(() => {
            emit({
              operation: "addTreeNode",
              spaceId: space.id!,
              payload: { parentId: null, index, data: node },
            });
          }, 50);
        }
        queryClient.invalidateQueries({ queryKey: ["recent-changes"] });

        navigate(buildPageUrl(space.slug, page.slugId, page.title));
        return page;
      } catch (error) {
        console.error("KhaiDocs: creating a page from a template failed", error);
        notifications.show({
          color: "red",
          message: t("Could not create a page from this template."),
        });
        return null;
      } finally {
        setCreatingId(null);
      }
    },
    [space.id, space.slug, navigate, setTreeData, emit, t],
  );

  return { create, creatingId };
}
