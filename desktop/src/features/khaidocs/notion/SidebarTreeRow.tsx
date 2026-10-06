/*
 * Original KhaiDocs code, MIT.
 *
 * A Notion-style row for Docmost's sidebar page tree (used in single-user
 * mode instead of SpaceTreeRow): compact, icon + title, the expand chevron
 * takes the icon's place on hover, "…" and "+" on hover. Folders show a
 * folder / open-folder icon. Drag and drop, keyboard navigation and
 * selection stay with Docmost's DocTree (this only renders the row).
 */

import { useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { useAtom } from "jotai";
import { useTranslation } from "react-i18next";
import { IconChevronRight, IconPlus } from "@tabler/icons-react";
import { queryClient } from "@/main.tsx";
import { buildPageUrl, getPageTitle } from "@/features/page/page.utils.ts";
import { getPageById } from "@/features/page/services/page-service.ts";
import { mobileSidebarAtom } from "@/components/layouts/global/hooks/atoms/sidebar-atom.ts";
import { useToggleSidebar } from "@/components/layouts/global/hooks/hooks/use-toggle-sidebar.ts";
import type { SpaceTreeNode } from "@/features/page/tree/types.ts";
import type { RenderRowProps } from "@/features/page/tree/components/doc-tree";
import { NodeMenu } from "@/features/page/tree/components/space-tree-node-menu";
import { PageIcon } from "./PageIcon";
import { IconPicker } from "./IconPicker";
import { isFolderIcon } from "./page-icon-codec";
import { useSetPageIcon } from "./use-page-icon";
import { useCreateNode } from "./tree-actions";
import classes from "./sidebar.module.css";

type Props = RenderRowProps<SpaceTreeNode> & { readOnly: boolean };

export function SidebarTreeRow({
  node,
  isOpen,
  hasChildren,
  toggleOpen,
  rowRef,
  tabIndex,
  treeItemProps,
  readOnly,
}: Props) {
  const { t } = useTranslation();
  const { spaceSlug } = useParams();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mobileSidebarOpened] = useAtom(mobileSidebarAtom);
  const toggleMobileSidebar = useToggleSidebar(mobileSidebarAtom);
  const setPageIcon = useSetPageIcon();
  const createNode = useCreateNode({ id: node.spaceId, slug: spaceSlug });

  const canEdit = !readOnly && node.canEdit !== false;
  const isFolder = isFolderIcon(node.icon);
  const expandable = hasChildren || isFolder;
  const title = getPageTitle(node.name, node.isBase, t);

  const prefetch = () => {
    timerRef.current = setTimeout(async () => {
      const page = await queryClient.fetchQuery({
        queryKey: ["pages", node.id],
        queryFn: () => getPageById({ pageId: node.id }),
        staleTime: 5 * 60 * 1000,
      });
      if (page?.slugId) queryClient.setQueryData(["pages", page.slugId], page);
    }, 150);
  };
  const cancelPrefetch = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const stop = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const icon = <PageIcon icon={node.icon} isBase={node.isBase} size={18} open={isFolder && isOpen} />;

  return (
    <Link
      ref={rowRef as React.Ref<HTMLAnchorElement>}
      to={buildPageUrl(spaceSlug, node.slugId, node.name)}
      className={classes.treeRow}
      data-expandable={expandable || undefined}
      tabIndex={tabIndex}
      {...treeItemProps}
      onClick={() => mobileSidebarOpened && toggleMobileSidebar()}
      onMouseEnter={prefetch}
      onMouseLeave={cancelPrefetch}
    >
      <span className={classes.iconSlot} onClick={stop}>
        {expandable && (
          <button
            type="button"
            tabIndex={-1}
            className={classes.chevron}
            data-open={isOpen || undefined}
            aria-label={isOpen ? t("Collapse") : t("Expand")}
            aria-expanded={isOpen}
            onClick={(e) => {
              stop(e);
              toggleOpen();
            }}
          >
            <IconChevronRight size={14} stroke={2} />
          </button>
        )}
        <span className={classes.iconFace}>
          {canEdit && !isFolder ? (
            <IconPicker
              value={node.icon}
              onChange={(value) => setPageIcon(node, value)}
              onRemove={() => setPageIcon(node, null)}
            >
              <button type="button" tabIndex={-1} className={classes.iconButton} aria-label={t("Change icon")}>
                {icon}
              </button>
            </IconPicker>
          ) : (
            icon
          )}
        </span>
      </span>

      <span className={classes.treeTitle}>{title}</span>

      <span className={classes.rowActions} onClick={stop}>
        <NodeMenu node={node} canEdit={canEdit} />
        {canEdit && (
          <button
            type="button"
            tabIndex={-1}
            className={classes.rowAction}
            aria-label={t("Create subpage of {{name}}", { name: node.name || t("untitled") })}
            onClick={(e) => {
              stop(e);
              createNode(node.id, "page");
            }}
          >
            <IconPlus size={15} stroke={2} />
          </button>
        )}
      </span>
    </Link>
  );
}
