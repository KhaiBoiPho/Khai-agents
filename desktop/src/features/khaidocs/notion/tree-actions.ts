/*
 * Original KhaiDocs code, MIT.
 *
 * Page/folder actions on Docmost's sidebar tree: create a page or folder
 * (optionally inside a folder), move a page into a folder, and list every
 * folder of a space. Same steps as Docmost's own tree mutations: API call,
 * optimistic tree update, websocket event.
 */

import { useCallback } from "react";
import { useSetAtom, useStore } from "jotai";
import { useNavigate } from "react-router-dom";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import { generateJitteredKeyBetween } from "fractional-indexing-jittered";
import {
  createPage,
  getAllSidebarPages,
  movePage,
} from "@/features/page/services/page-service.ts";
import {
  fetchAllAncestorChildren,
  invalidateOnCreatePage,
} from "@/features/page/queries/page-query.ts";
import { treeDataAtom } from "@/features/page/tree/atoms/tree-data-atom.ts";
import { openTreeNodesAtom } from "@/features/page/tree/atoms/open-tree-nodes-atom.ts";
import { treeModel } from "@/features/page/tree/model/tree-model";
import { spaceRoots, updateSpaceRoots } from "@/features/page/tree/utils/utils.ts";
import { useTreeMutation } from "@/features/page/tree/hooks/use-tree-mutation.ts";
import type { SpaceTreeNode } from "@/features/page/tree/types.ts";
import type { IPage } from "@/features/page/types/page.types.ts";
import { buildPageUrl } from "@/features/page/page.utils.ts";
import { useQueryEmit } from "@/features/websocket/use-query-emit.ts";
import { queryClient } from "@/main.tsx";
import { folderIcon, isFolderIcon } from "./page-icon-codec";

/** Loads a node's children into the tree if it has some that aren't loaded. */
export function useEnsureChildrenLoaded(spaceId: string) {
  const store = useStore();
  const setData = useSetAtom(treeDataAtom);
  return useCallback(
    async (nodeId: string) => {
      const node = treeModel.find(
        spaceRoots(store.get(treeDataAtom), spaceId),
        nodeId,
      ) as SpaceTreeNode | null;
      if (!node || !node.hasChildren || node.children?.length) return;
      const children = await fetchAllAncestorChildren({ pageId: nodeId, spaceId });
      setData((prev) => treeModel.appendChildren(prev, nodeId, children));
    },
    [store, setData, spaceId],
  );
}

export function useCreateNode(space: { id?: string; slug?: string } | undefined) {
  const { t } = useTranslation();
  const store = useStore();
  const setData = useSetAtom(treeDataAtom);
  const setOpen = useSetAtom(openTreeNodesAtom);
  const navigate = useNavigate();
  const emit = useQueryEmit();
  const ensureChildren = useEnsureChildrenLoaded(space?.id ?? "");

  return useCallback(
    async (parentId: string | null, kind: "page" | "folder" = "page") => {
      if (!space?.id) return;
      const spaceId = space.id;
      if (parentId) {
        await ensureChildren(parentId);
        setOpen((prev) => ({ ...prev, [parentId]: true }));
      }
      let created: IPage;
      try {
        created = await createPage({
          spaceId,
          ...(parentId ? { parentPageId: parentId } : {}),
          ...(kind === "folder" ? { icon: folderIcon("gray") } : {}),
        });
        invalidateOnCreatePage(created);
      } catch {
        notifications.show({ message: t("Failed to create page"), color: "red" });
        return;
      }
      const node: SpaceTreeNode = {
        id: created.id,
        slugId: created.slugId,
        name: created.title ?? "",
        icon: created.icon ?? undefined,
        position: created.position,
        spaceId: created.spaceId,
        parentPageId: created.parentPageId,
        hasChildren: false,
        children: [],
      };
      const current = spaceRoots(store.get(treeDataAtom), spaceId);
      const index = parentId
        ? (treeModel.find(current, parentId)?.children?.length ?? 0)
        : current.length;
      setData((prev) =>
        updateSpaceRoots(prev, spaceId, (roots) => {
          let next = treeModel.insert(roots, parentId, node, index);
          if (parentId) {
            next = treeModel.update(next, parentId, {
              hasChildren: true,
            } as Partial<SpaceTreeNode>);
          }
          return next;
        }),
      );
      setTimeout(() => {
        emit({
          operation: "addTreeNode",
          spaceId,
          payload: { parentId, index, data: node },
        });
      }, 50);
      navigate(buildPageUrl(space.slug, created.slugId, created.title));
    },
    [space?.id, space?.slug, ensureChildren, setOpen, store, setData, emit, navigate, t],
  );
}

/** Moves a page under a folder (or to the top level with null). */
export function useMoveToFolder(spaceId: string) {
  const { t } = useTranslation();
  const store = useStore();
  const setData = useSetAtom(treeDataAtom);
  const setOpen = useSetAtom(openTreeNodesAtom);
  const { handleMove } = useTreeMutation(spaceId);
  const ensureChildren = useEnsureChildrenLoaded(spaceId);

  return useCallback(
    async (pageId: string, folderId: string | null) => {
      const tree = spaceRoots(store.get(treeDataAtom), spaceId);
      const source = treeModel.find(tree, pageId);
      if (folderId && source && treeModel.find(tree, folderId)) {
        await ensureChildren(folderId);
        await handleMove(pageId, { kind: "make-child", targetId: folderId });
        setOpen((prev) => ({ ...prev, [folderId]: true }));
        return;
      }
      if (!folderId && source) {
        const last = tree[tree.length - 1];
        if (last && last.id !== pageId) {
          await handleMove(pageId, { kind: "reorder-after", targetId: last.id });
        }
        return;
      }
      // The folder isn't loaded in the sidebar: move through the API and
      // drop the page from the loaded tree; the folder loads it on expand.
      try {
        let lastPosition: string | null = null;
        if (folderId) {
          const children = await getAllSidebarPages({ pageId: folderId, spaceId });
          const items = children.pages.flatMap((p) => p.items);
          lastPosition = items.length ? items[items.length - 1].position : null;
        }
        await movePage({
          pageId,
          parentPageId: folderId,
          position: generateJitteredKeyBetween(lastPosition, null),
        });
        setData((prev) => treeModel.remove(prev, pageId));
        queryClient.removeQueries({
          predicate: (q) =>
            ["sidebar-pages", "breadcrumbs"].includes(q.queryKey[0] as string),
        });
      } catch {
        notifications.show({ message: t("Failed to move page"), color: "red" });
      }
    },
    [store, spaceId, ensureChildren, handleMove, setOpen, setData, t],
  );
}

export interface FolderEntry {
  id: string;
  slugId: string;
  title: string;
  icon: string;
  parentPageId: string | null;
  /** Titles of the pages above it, outermost first. */
  path: string[];
  /** Ids of the pages above it. */
  ancestorIds: string[];
}

/**
 * Every folder of a space, walking the page tree level by level. Only pages
 * with children are expanded (an empty folder still shows up as a child of
 * its parent).
 */
export async function listFolders(spaceId: string): Promise<FolderEntry[]> {
  const folders: FolderEntry[] = [];
  type Level = { parentId: string | null; path: string[]; ids: string[] };
  let queue: Level[] = [{ parentId: null, path: [], ids: [] }];
  let guard = 0;
  while (queue.length && guard < 40) {
    guard++;
    const next: Level[] = [];
    const results = await Promise.all(
      queue.map(async (level) => {
        const data = await getAllSidebarPages(
          level.parentId ? { pageId: level.parentId, spaceId } : { spaceId },
        );
        return { level, items: data.pages.flatMap((p) => p.items) };
      }),
    );
    for (const { level, items } of results) {
      for (const item of items) {
        const isFolder = isFolderIcon(item.icon);
        const title = item.title || "Untitled";
        if (isFolder) {
          folders.push({
            id: item.id,
            slugId: item.slugId,
            title: item.title,
            icon: item.icon,
            parentPageId: item.parentPageId ?? null,
            path: level.path,
            ancestorIds: level.ids,
          });
        }
        if (item.hasChildren) {
          next.push({
            parentId: item.id,
            path: [...level.path, title],
            ids: [...level.ids, item.id],
          });
        }
      }
    }
    queue = next;
  }
  return folders;
}
