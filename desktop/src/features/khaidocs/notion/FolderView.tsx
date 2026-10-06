/*
 * Original KhaiDocs code, MIT.
 *
 * What opening a folder shows: its icon and (editable) title, then a
 * Notion-like list of what it contains — folders first, then pages — with
 * each item's last edit, and "New page" / "New folder".
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAtomValue } from "jotai";
import { Container, Text, UnstyledButton } from "@mantine/core";
import { IconChevronRight, IconFolderPlus, IconPlus } from "@tabler/icons-react";
import { useQueries } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import editorClasses from "@/features/editor/styles/editor.module.css";
import { TitleEditor } from "@/features/editor/title-editor";
import { fetchAllAncestorChildren } from "@/features/page/queries/page-query.ts";
import { getPageById } from "@/features/page/services/page-service.ts";
import { treeDataAtom } from "@/features/page/tree/atoms/tree-data-atom.ts";
import { treeModel } from "@/features/page/tree/model/tree-model";
import type { SpaceTreeNode } from "@/features/page/tree/types.ts";
import { buildPageUrl } from "@/features/page/page.utils.ts";
import type { IPage } from "@/features/page/types/page.types.ts";
import { useTimeAgo } from "@/hooks/use-time-ago.tsx";
import { PageHead } from "./PageTop";
import { PageIcon } from "./PageIcon";
import { isFolderIcon, sortFoldersFirst } from "./page-icon-codec";
import { useCreateNode } from "./tree-actions";
import classes from "./sidebar.module.css";

export function FolderView({ page, editable }: { page: IPage; editable: boolean }) {
  const { t } = useTranslation();
  const tree = useAtomValue(treeDataAtom);
  const node = treeModel.find(tree, page.id) as SpaceTreeNode | null;
  const [fetched, setFetched] = useState<SpaceTreeNode[] | null>(null);
  const createNode = useCreateNode(page.space);

  const loaded = node && (!node.hasChildren || node.children?.length > 0);
  useEffect(() => {
    if (loaded) return;
    let live = true;
    fetchAllAncestorChildren({ pageId: page.id, spaceId: page.spaceId })
      .then((children) => live && setFetched(children))
      .catch(() => live && setFetched([]));
    return () => {
      live = false;
    };
  }, [page.id, page.spaceId, loaded]);

  const children = useMemo(
    () => sortFoldersFirst((loaded ? node.children : fetched) ?? []),
    [loaded, node, fetched],
  );

  // Last edit of each item (the sidebar API doesn't include it).
  const details = useQueries({
    queries: children.slice(0, 60).map((child) => ({
      queryKey: ["pages", child.id],
      queryFn: () => getPageById({ pageId: child.id }),
      staleTime: 60 * 1000,
    })),
  });
  const updatedAt = new Map<string, Date | undefined>(
    details.map((d, i) => [children[i]?.id, d.data?.updatedAt]),
  );

  const folders = children.filter((c) => isFolderIcon(c.icon)).length;
  const pages = children.length - folders;

  return (
    <Container size={816} className={`${editorClasses.editor} kd-editor kd-folder`}>
      <PageHead page={page} editable={editable} />
      <TitleEditor
        pageId={page.id}
        slugId={page.slugId}
        title={page.title}
        spaceSlug={page.space?.slug ?? ""}
        editable={editable}
      />
      <div className={classes.folderBody}>
        <div className={classes.folderBar}>
          <Text size="sm" c="dimmed">
            {children.length === 0
              ? t("Empty folder")
              : [
                  folders ? t("{{count}} folders", { count: folders }) : null,
                  pages ? t("{{count}} pages", { count: pages }) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
          </Text>
          {editable && (
            <div style={{ display: "flex", gap: 4 }}>
              <UnstyledButton className={classes.folderAction} onClick={() => createNode(page.id, "page")}>
                <IconPlus size={15} stroke={1.75} /> {t("New page")}
              </UnstyledButton>
              <UnstyledButton className={classes.folderAction} onClick={() => createNode(page.id, "folder")}>
                <IconFolderPlus size={15} stroke={1.75} /> {t("New folder")}
              </UnstyledButton>
            </div>
          )}
        </div>
        {children.length === 0 && (fetched !== null || loaded) && (
          <div className={classes.folderEmpty}>
            <Text size="sm" c="dimmed">
              {t("Nothing here yet. Add a page, or drag pages onto this folder in the sidebar.")}
            </Text>
          </div>
        )}
        <div role="list">
          {children.map((child) => (
            <FolderRow
              key={child.id}
              node={child}
              spaceSlug={page.space?.slug}
              updatedAt={updatedAt.get(child.id)}
            />
          ))}
        </div>
      </div>
    </Container>
  );
}

function FolderRow({
  node,
  spaceSlug,
  updatedAt,
}: {
  node: SpaceTreeNode;
  spaceSlug?: string;
  updatedAt?: Date;
}) {
  const { t } = useTranslation();
  const edited = useTimeAgo(updatedAt);
  return (
    <UnstyledButton
      component={Link}
      to={buildPageUrl(spaceSlug, node.slugId, node.name)}
      className={classes.folderRow}
      role="listitem"
    >
      <PageIcon icon={node.icon} isBase={node.isBase} size={20} />
      <span className={classes.folderRowTitle}>{node.name || t("Untitled")}</span>
      {updatedAt && <span className={classes.folderRowMeta}>{edited}</span>}
      <IconChevronRight size={14} className={classes.folderRowChevron} />
    </UnstyledButton>
  );
}
